"""App de escritorio (Tkinter): carga un PDF, valida contra el total del
estado de cuenta, categoriza por reglas de negocio editables, y exporta las
transacciones normalizadas — el archivo que después sube el Sincronizador.

Reemplaza al watcher automático que estaba planeado originalmente: aquí el
punto de entrada al pipeline es "cargar un PDF" desde la UI, no una carpeta
vigilada. Absorbe lo que iban a ser los módulos Transformador y Categorizador
como librerías (transform/), y deja el archivo final listo en data/procesados/
para que el Sincronizador (siguiente fase) lo suba a Supabase.

Correr:
    python -m app.main
"""

from __future__ import annotations

import hashlib
import json
import tkinter as tk
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import pdfplumber

from parsers._anonimizador import anonimizar
from parsers.base import BaseParser, RenglonCrudo
from parsers.ejemplo import EjemploParser
from parsers.banamex import BanamexParser
from transform.categorizador import Regla, cargar_reglas, categorizar, guardar_reglas
from transform.transformador import (
    TransaccionCanonica,
    transformar_renglones,
    validar_contra_total,
)

RAIZ = Path(__file__).parent.parent
CARPETA_PROCESADOS = RAIZ / "data" / "procesados"
CARPETA_ERRORES = RAIZ / "data" / "errores"

# Registro de bancos soportados. Al copiar parsers/ejemplo.py para un banco
# real (ver su docstring), agrega la clase nueva aquí.
PARSERS: dict[str, type[BaseParser]] = {
    "Ejemplo": EjemploParser,
    "Banamex": BanamexParser,
}

COLUMNAS = ("pagina", "fecha", "descripcion", "monto", "tipo", "categoria")

# Debe coincidir exactamente con la categoría de esa regla en
# transform/reglas_categorizacion.json — así el panel de totales puede
# separarla del resto de los cargos.
CATEGORIA_DISPOSICION_EFECTIVO = "Disposición de efectivo"


def _hash_pdf(ruta: Path) -> str:
    return hashlib.sha256(ruta.read_bytes()).hexdigest()


class VentanaReglas(tk.Toplevel):
    """Editor de reglas de categorización — se abre sobre la ventana principal."""

    def __init__(self, master: "App") -> None:
        super().__init__(master)
        self.title("Reglas de categorización")
        self.geometry("420x420")
        self.master_app = master
        self.reglas = list(master.reglas)

        self.tabla = ttk.Treeview(
            self, columns=("patron", "categoria"), show="headings", height=12
        )
        self.tabla.heading("patron", text="Patrón (en la descripción)")
        self.tabla.heading("categoria", text="Categoría")
        self.tabla.pack(fill="both", expand=True, padx=8, pady=8)
        self._refrescar_tabla()

        marco_form = ttk.Frame(self)
        marco_form.pack(fill="x", padx=8, pady=4)

        ttk.Label(marco_form, text="Patrón:").grid(row=0, column=0, sticky="w")
        self.entrada_patron = ttk.Entry(marco_form)
        self.entrada_patron.grid(row=0, column=1, sticky="ew", padx=4)

        ttk.Label(marco_form, text="Categoría:").grid(row=1, column=0, sticky="w")
        self.entrada_categoria = ttk.Entry(marco_form)
        self.entrada_categoria.grid(row=1, column=1, sticky="ew", padx=4)
        marco_form.columnconfigure(1, weight=1)

        marco_botones = ttk.Frame(self)
        marco_botones.pack(fill="x", padx=8, pady=4)
        ttk.Button(marco_botones, text="Agregar regla", command=self._agregar).pack(
            side="left"
        )
        ttk.Button(
            marco_botones, text="Eliminar seleccionada", command=self._eliminar
        ).pack(side="left", padx=4)
        ttk.Button(
            marco_botones, text="Guardar y cerrar", command=self._guardar_y_cerrar
        ).pack(side="right")

    def _refrescar_tabla(self) -> None:
        self.tabla.delete(*self.tabla.get_children())
        for regla in self.reglas:
            self.tabla.insert("", "end", values=(regla.patron, regla.categoria))

    def _agregar(self) -> None:
        patron = self.entrada_patron.get().strip()
        categoria = self.entrada_categoria.get().strip()
        if not patron or not categoria:
            messagebox.showwarning(
                "Falta información", "Escribe un patrón y una categoría."
            )
            return
        self.reglas.append(Regla(patron, categoria))
        self.entrada_patron.delete(0, "end")
        self.entrada_categoria.delete(0, "end")
        self._refrescar_tabla()

    def _eliminar(self) -> None:
        seleccion = self.tabla.selection()
        if not seleccion:
            return
        indice = self.tabla.index(seleccion[0])
        del self.reglas[indice]
        self._refrescar_tabla()

    def _guardar_y_cerrar(self) -> None:
        guardar_reglas(self.reglas)
        self.master_app.reglas = self.reglas
        self.master_app.recategorizar()
        self.destroy()


class VentanaInspeccion(tk.Toplevel):
    """Muestra el texto crudo que pdfplumber extrae de un PDF, página por
    página, línea por línea — para diseñar o ajustar el PATRON_RENGLON de un
    extractor nuevo sin pasar por la terminal. Equivalente en UI a
    `python -m parsers._inspeccionar`."""

    def __init__(self, master: tk.Misc) -> None:
        super().__init__(master)
        self.title("Inspeccionar PDF (para diseñar un extractor)")
        self.geometry("760x600")

        self._contenido_crudo: str = ""

        marco_superior = ttk.Frame(self)
        marco_superior.pack(fill="x", padx=8, pady=8)
        ttk.Button(
            marco_superior, text="Elegir PDF...", command=self._elegir_pdf
        ).pack(side="left")
        self.etiqueta_archivo = ttk.Label(marco_superior, text="Ningún archivo elegido.")
        self.etiqueta_archivo.pack(side="left", padx=8)

        # Anonimizado por defecto: así lo primero que ves ya es seguro de
        # compartir. Desmárcalo solo para tu propia referencia, nunca para
        # copiar y pegar en otro lado.
        self.var_anonimizar = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            marco_superior,
            text="Anonimizar (oculta nombres/montos/cuentas reales)",
            variable=self.var_anonimizar,
            command=self._refrescar_vista,
        ).pack(side="left", padx=12)
        ttk.Button(
            marco_superior, text="Copiar todo", command=self._copiar_todo
        ).pack(side="left")

        marco_texto = ttk.Frame(self)
        marco_texto.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        scrollbar_y = ttk.Scrollbar(marco_texto, orient="vertical")
        scrollbar_y.pack(side="right", fill="y")
        scrollbar_x = ttk.Scrollbar(self, orient="horizontal")
        scrollbar_x.pack(fill="x", padx=8)

        self.texto = tk.Text(
            marco_texto,
            wrap="none",
            font=("Consolas", 9),
            yscrollcommand=scrollbar_y.set,
            xscrollcommand=scrollbar_x.set,
        )
        self.texto.pack(fill="both", expand=True, side="left")
        scrollbar_y.config(command=self.texto.yview)
        scrollbar_x.config(command=self.texto.xview)

    def _elegir_pdf(self) -> None:
        ruta_texto = filedialog.askopenfilename(
            title="Selecciona el PDF a inspeccionar",
            filetypes=[("PDF", "*.pdf")],
        )
        if not ruta_texto:
            return

        ruta = Path(ruta_texto)
        self.etiqueta_archivo.config(text=ruta.name)

        lineas_salida: list[str] = []
        try:
            with pdfplumber.open(ruta) as pdf:
                for numero, pagina in enumerate(pdf.pages, start=1):
                    lineas_salida.append(f"=== Página {numero} — texto plano ===")
                    texto_pagina = pagina.extract_text() or "(sin texto extraíble)"
                    for i, linea in enumerate(texto_pagina.splitlines()):
                        lineas_salida.append(f"{i:3} | {linea!r}")

                    tablas = pagina.extract_tables()
                    lineas_salida.append(
                        f"\n=== Página {numero} — tablas detectadas: {len(tablas)} ==="
                    )
                    for indice_tabla, tabla in enumerate(tablas):
                        lineas_salida.append(f"\n-- Tabla {indice_tabla} ({len(tabla)} filas) --")
                        for fila in tabla:
                            lineas_salida.append(repr(fila))
                    lineas_salida.append("")
        except Exception as error:  # noqa: BLE001 — se lo mostramos tal cual
            messagebox.showerror("Error al leer el PDF", str(error))
            return

        self._contenido_crudo = "\n".join(lineas_salida)
        self._refrescar_vista()

    def _refrescar_vista(self) -> None:
        contenido = self._contenido_crudo
        if self.var_anonimizar.get():
            contenido = anonimizar(contenido)
        self.texto.delete("1.0", "end")
        self.texto.insert("1.0", contenido)

    def _copiar_todo(self) -> None:
        self.clipboard_clear()
        self.clipboard_append(self.texto.get("1.0", "end-1c"))


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Dashboard Financiero — revisión de estados de cuenta")
        self.geometry("900x600")

        self.reglas: list[Regla] = cargar_reglas()
        self.transacciones: list[TransaccionCanonica] = []
        self.ruta_pdf_actual: Path | None = None
        self.banco_actual: str | None = None

        self._construir_ui()

    def _construir_ui(self) -> None:
        marco_superior = ttk.Frame(self)
        marco_superior.pack(fill="x", padx=8, pady=8)

        ttk.Label(marco_superior, text="Banco:").pack(side="left")
        self.combo_banco = ttk.Combobox(
            marco_superior, values=list(PARSERS), state="readonly", width=20
        )
        self.combo_banco.current(0)
        self.combo_banco.pack(side="left", padx=4)

        ttk.Label(marco_superior, text="Formato de fecha:").pack(
            side="left", padx=(12, 0)
        )
        self.entrada_formato_fecha = ttk.Entry(marco_superior, width=12)
        self.entrada_formato_fecha.insert(0, "%d/%m/%Y")
        self.entrada_formato_fecha.pack(side="left", padx=4)

        ttk.Label(marco_superior, text="Año (si el PDF no lo trae):").pack(
            side="left", padx=(12, 0)
        )
        self.entrada_anio = ttk.Entry(marco_superior, width=6)
        self.entrada_anio.insert(0, str(datetime.now().year))
        self.entrada_anio.pack(side="left", padx=4)

        ttk.Button(marco_superior, text="Cargar PDF...", command=self.cargar_pdf).pack(
            side="left", padx=12
        )
        ttk.Button(
            marco_superior, text="Reglas de categorización...", command=self.abrir_reglas
        ).pack(side="left")
        ttk.Button(
            marco_superior,
            text="Inspeccionar PDF...",
            command=self.abrir_inspeccion,
        ).pack(side="left", padx=(4, 0))

        self.tabla = ttk.Treeview(self, columns=COLUMNAS, show="headings")
        encabezados = {
            "pagina": "Pág.",
            "fecha": "Fecha",
            "descripcion": "Descripción",
            "monto": "Monto",
            "tipo": "Tipo",
            "categoria": "Categoría",
        }
        anchos = {
            "pagina": 40,
            "fecha": 90,
            "descripcion": 320,
            "monto": 90,
            "tipo": 70,
            "categoria": 130,
        }
        for col in COLUMNAS:
            self.tabla.heading(col, text=encabezados[col])
            self.tabla.column(col, width=anchos[col], anchor="w")
        self.tabla.pack(fill="both", expand=True, padx=8, pady=4)

        self.etiqueta_resumen = ttk.Label(self, text="Sin datos cargados.")
        self.etiqueta_resumen.pack(fill="x", padx=8)

        marco_totales = ttk.LabelFrame(self, text="Totales de la tabla cargada")
        marco_totales.pack(fill="x", padx=8, pady=(0, 8))
        self.etiqueta_totales = ttk.Label(
            marco_totales,
            text="Cargos: — · Disposición de efectivo: — · Abonos: —",
            font=("Consolas", 10),
        )
        self.etiqueta_totales.pack(fill="x", padx=8, pady=6)

        marco_validacion = ttk.LabelFrame(self, text="Validación de totales")
        marco_validacion.pack(fill="x", padx=8, pady=8)

        ttk.Label(
            marco_validacion,
            text="Total esperado (neto del periodo, según el estado de cuenta):",
        ).pack(side="left", padx=4, pady=6)
        self.entrada_total_esperado = ttk.Entry(marco_validacion, width=14)
        self.entrada_total_esperado.pack(side="left", padx=4)
        ttk.Button(marco_validacion, text="Validar", command=self.validar).pack(
            side="left", padx=8
        )
        self.etiqueta_validacion = ttk.Label(marco_validacion, text="")
        self.etiqueta_validacion.pack(side="left", padx=8)

        self.boton_guardar = ttk.Button(
            self,
            text="Guardar archivo procesado",
            command=self.guardar_procesado,
            state="disabled",
        )
        self.boton_guardar.pack(padx=8, pady=8, anchor="e")

    def cargar_pdf(self) -> None:
        ruta_texto = filedialog.askopenfilename(
            title="Selecciona el estado de cuenta",
            filetypes=[("PDF", "*.pdf")],
        )
        if not ruta_texto:
            return
        ruta_pdf = Path(ruta_texto)

        banco = self.combo_banco.get()
        formato_fecha = self.entrada_formato_fecha.get().strip() or "%d/%m/%Y"
        anio = self.entrada_anio.get().strip()
        parser_cls = PARSERS[banco]

        try:
            try:
                # Algunos extractores necesitan el año (el PDF no lo trae
                # impreso en cada renglón); otros no aceptan ese argumento.
                parser = parser_cls(ano_estado_de_cuenta=anio)
            except TypeError:
                parser = parser_cls()
            renglones: list[RenglonCrudo] = parser.extraer(ruta_pdf)
        except Exception as error:  # noqa: BLE001 — se lo mostramos tal cual al usuario
            self._mover_a_errores(ruta_pdf, str(error))
            messagebox.showerror(
                "Error al extraer",
                f"No se pudo leer el PDF con el extractor de {banco}:\n{error}\n\n"
                f"El archivo se movió a {CARPETA_ERRORES}.",
            )
            return

        if not renglones:
            messagebox.showwarning(
                "Sin transacciones",
                "El extractor no encontró ninguna transacción en este PDF. "
                "¿Elegiste el banco correcto, o el patrón del extractor no "
                "coincide con este formato?",
            )
            return

        transacciones, fallidas = transformar_renglones(renglones, formato_fecha)
        transacciones = [
            replace(t, categoria=categorizar(t.descripcion, self.reglas))
            for t in transacciones
        ]

        self.transacciones = transacciones
        self.ruta_pdf_actual = ruta_pdf
        self.banco_actual = banco
        self._refrescar_tabla()
        self._actualizar_totales()

        resumen = f"{len(transacciones)} transacciones cargadas"
        if fallidas:
            resumen += f" — {len(fallidas)} renglones no se pudieron interpretar (revisa el formato de fecha o el patrón del extractor)"
        self.etiqueta_resumen.config(text=resumen)
        self.etiqueta_validacion.config(text="")
        self.boton_guardar.config(state="normal")

        if fallidas:
            detalle = "\n".join(
                f"- {r.linea_cruda!r}: {e}" for r, e in fallidas[:10]
            )
            messagebox.showwarning(
                "Renglones no interpretados",
                f"{len(fallidas)} renglón(es) no se pudieron normalizar:\n\n{detalle}",
            )

    def recategorizar(self) -> None:
        self.transacciones = [
            replace(t, categoria=categorizar(t.descripcion, self.reglas))
            for t in self.transacciones
        ]
        self._refrescar_tabla()
        self._actualizar_totales()

    def _refrescar_tabla(self) -> None:
        self.tabla.delete(*self.tabla.get_children())
        for t in self.transacciones:
            categoria = t.categoria or "(sin categoría)"
            self.tabla.insert(
                "",
                "end",
                values=(
                    t.pagina,
                    t.fecha.isoformat(),
                    t.descripcion,
                    f"{t.monto:.2f}",
                    t.tipo,
                    categoria,
                ),
            )

    def _actualizar_totales(self) -> None:
        cargos_efectivo = [
            t
            for t in self.transacciones
            if t.tipo == "cargo" and t.categoria == CATEGORIA_DISPOSICION_EFECTIVO
        ]
        otros_cargos = [
            t
            for t in self.transacciones
            if t.tipo == "cargo" and t.categoria != CATEGORIA_DISPOSICION_EFECTIVO
        ]
        abonos = [t for t in self.transacciones if t.tipo == "abono"]

        total_efectivo = sum((t.monto for t in cargos_efectivo), start=Decimal("0"))
        total_otros_cargos = sum((t.monto for t in otros_cargos), start=Decimal("0"))
        total_abonos = sum((t.monto for t in abonos), start=Decimal("0"))

        self.etiqueta_totales.config(
            text=(
                f"Cargos: {total_otros_cargos:,.2f} ({len(otros_cargos)})   ·   "
                f"Disposición de efectivo: {total_efectivo:,.2f} ({len(cargos_efectivo)})   ·   "
                f"Abonos: {total_abonos:,.2f} ({len(abonos)})"
            )
        )

    def validar(self) -> None:
        if not self.transacciones:
            return
        texto = self.entrada_total_esperado.get().strip().replace(",", "")
        try:
            total_esperado = Decimal(texto)
        except InvalidOperation:
            messagebox.showwarning(
                "Total inválido", "Escribe el total esperado como un número, ej. 1215.50"
            )
            return

        resultado = validar_contra_total(self.transacciones, total_esperado)
        if resultado.ok:
            self.etiqueta_validacion.config(
                text=f"✓ Cuadra (calculado {resultado.total_calculado})",
                foreground="green",
            )
        else:
            self.etiqueta_validacion.config(
                text=(
                    f"✗ No cuadra: calculado {resultado.total_calculado}, "
                    f"esperado {resultado.total_esperado}, "
                    f"diferencia {resultado.diferencia}"
                ),
                foreground="red",
            )

    def abrir_reglas(self) -> None:
        VentanaReglas(self)

    def abrir_inspeccion(self) -> None:
        VentanaInspeccion(self)

    def guardar_procesado(self) -> None:
        if not self.transacciones or self.ruta_pdf_actual is None:
            return

        documento_hash = _hash_pdf(self.ruta_pdf_actual)
        salida = {
            "banco": self.banco_actual,
            "documento_hash": documento_hash,
            "ruta_pdf_original": str(self.ruta_pdf_actual),
            "procesado_en": datetime.now(timezone.utc).isoformat(),
            "transacciones": [
                {
                    "fecha": t.fecha.isoformat(),
                    "descripcion": t.descripcion,
                    "monto": str(t.monto),
                    "tipo": t.tipo,
                    "moneda": t.moneda,
                    "saldo": str(t.saldo) if t.saldo is not None else None,
                    "pagina": t.pagina,
                    "linea_cruda": t.linea_cruda,
                    "categoria": t.categoria,
                }
                for t in self.transacciones
            ],
        }

        CARPETA_PROCESADOS.mkdir(parents=True, exist_ok=True)
        ruta_salida = CARPETA_PROCESADOS / f"{documento_hash}.json"
        ruta_salida.write_text(
            json.dumps(salida, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        messagebox.showinfo(
            "Guardado",
            f"Archivo procesado guardado en:\n{ruta_salida}\n\n"
            "Listo para que el Sincronizador (próxima fase) lo suba a Supabase.",
        )

    def _mover_a_errores(self, ruta_pdf: Path, motivo: str) -> None:
        CARPETA_ERRORES.mkdir(parents=True, exist_ok=True)
        destino = CARPETA_ERRORES / ruta_pdf.name
        try:
            ruta_pdf.replace(destino)
            (CARPETA_ERRORES / f"{ruta_pdf.stem}.log").write_text(
                motivo, encoding="utf-8"
            )
        except OSError:
            pass  # el PDF puede estar fuera de data/nuevos/; no es fatal


def main() -> None:
    App().mainloop()


if __name__ == "__main__":
    main()
