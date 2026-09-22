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
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import pdfplumber

from parsers._anonimizador import anonimizar
from parsers.base import BaseParser, RenglonCrudo
from parsers.ejemplo import EjemploParser
from parsers.banamex import BanamexParser
from parsers.banamex_tdc import BanamexTdcParser
from parsers.invex_tdc import InvexTdcParser
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
    "Banamex TDC": BanamexTdcParser,
    "Invex TDC": InvexTdcParser,
}

COLUMNAS = ("pagina", "fecha", "descripcion", "monto", "tipo", "categoria", "comercio", "tarjeta", "origen")

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
            self, columns=("patron", "categoria", "comercio"), show="headings", height=12
        )
        self.tabla.heading("patron", text="Patrón (en la descripción)")
        self.tabla.heading("categoria", text="Categoría")
        self.tabla.heading("comercio", text="Comercio")
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

        ttk.Label(marco_form, text="Comercio (opcional):").grid(row=2, column=0, sticky="w")
        self.entrada_comercio = ttk.Entry(marco_form)
        self.entrada_comercio.grid(row=2, column=1, sticky="ew", padx=4)
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
            self.tabla.insert(
                "", "end", values=(regla.patron, regla.categoria, regla.comercio or "")
            )

    def _agregar(self) -> None:
        patron = self.entrada_patron.get().strip()
        categoria = self.entrada_categoria.get().strip()
        comercio = self.entrada_comercio.get().strip() or None
        if not patron or not categoria:
            messagebox.showwarning(
                "Falta información", "Escribe un patrón y una categoría."
            )
            return
        self.reglas.append(Regla(patron, categoria, comercio))
        self.entrada_patron.delete(0, "end")
        self.entrada_categoria.delete(0, "end")
        self.entrada_comercio.delete(0, "end")
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


class VentanaRenglonManual(tk.Toplevel):
    """Para capturar a mano una transacción que el extractor no pudo leer
    del PDF -- el caso real que motivó esto: una fila de "abono" que el PDF
    renderiza como imagen en vez de texto seleccionable (ver
    `BaseParser.advertencias()`), así que no hay nada que un regex pueda
    extraer ahí. Se agrega a `self.transacciones` exactamente como una fila
    extraída -- entra en la tabla, en los totales, en la validación contra
    el total del estado de cuenta, y se exporta/sincroniza igual.

    Requiere un PDF ya cargado (`master.ruta_pdf_actual`): un renglón
    manual todavía pertenece a un documento concreto para efectos de
    auditoría (`origen`) y de a qué se sincroniza en Supabase.
    """

    def __init__(self, master: "App") -> None:
        super().__init__(master)
        self.title("Agregar renglón manual")
        self.geometry("380x290")
        self.master_app = master

        marco = ttk.Frame(self)
        marco.pack(fill="both", expand=True, padx=8, pady=8)

        ttk.Label(marco, text="Fecha (AAAA-MM-DD):").grid(row=0, column=0, sticky="w", pady=2)
        self.entrada_fecha = ttk.Entry(marco)
        self.entrada_fecha.insert(0, date.today().isoformat())
        self.entrada_fecha.grid(row=0, column=1, sticky="ew", padx=4)

        ttk.Label(marco, text="Descripción:").grid(row=1, column=0, sticky="w", pady=2)
        self.entrada_descripcion = ttk.Entry(marco)
        self.entrada_descripcion.grid(row=1, column=1, sticky="ew", padx=4)

        ttk.Label(marco, text="Monto (sin signo):").grid(row=2, column=0, sticky="w", pady=2)
        self.entrada_monto = ttk.Entry(marco)
        self.entrada_monto.grid(row=2, column=1, sticky="ew", padx=4)

        ttk.Label(marco, text="Tipo:").grid(row=3, column=0, sticky="w", pady=2)
        self.combo_tipo = ttk.Combobox(
            marco, values=["cargo", "abono"], state="readonly"
        )
        self.combo_tipo.current(0)
        self.combo_tipo.grid(row=3, column=1, sticky="ew", padx=4)

        ttk.Label(marco, text="Página (si la conoces, opcional):").grid(
            row=4, column=0, sticky="w", pady=2
        )
        self.entrada_pagina = ttk.Entry(marco)
        self.entrada_pagina.grid(row=4, column=1, sticky="ew", padx=4)

        ttk.Label(marco, text="Tarjeta (opcional, ej. Titular):").grid(
            row=5, column=0, sticky="w", pady=2
        )
        self.entrada_tarjeta = ttk.Entry(marco)
        self.entrada_tarjeta.grid(row=5, column=1, sticky="ew", padx=4)

        marco.columnconfigure(1, weight=1)

        ttk.Label(
            marco,
            text=(
                "Categoría/comercio se asignan solo con las reglas actuales, "
                "igual que una fila extraída del PDF."
            ),
            foreground="#666",
            wraplength=340,
        ).grid(row=6, column=0, columnspan=2, sticky="w", pady=(8, 0))

        marco_botones = ttk.Frame(self)
        marco_botones.pack(fill="x", padx=8, pady=8)
        ttk.Button(marco_botones, text="Agregar", command=self._agregar).pack(
            side="left"
        )
        ttk.Button(marco_botones, text="Cerrar", command=self.destroy).pack(
            side="right"
        )

    def _agregar(self) -> None:
        fecha_texto = self.entrada_fecha.get().strip()
        descripcion = self.entrada_descripcion.get().strip()
        monto_texto = self.entrada_monto.get().strip().replace(",", "")
        tipo = self.combo_tipo.get()
        pagina_texto = self.entrada_pagina.get().strip()
        tarjeta = self.entrada_tarjeta.get().strip() or None

        try:
            fecha = date.fromisoformat(fecha_texto)
        except ValueError:
            messagebox.showwarning(
                "Fecha inválida", "Escribe la fecha como AAAA-MM-DD, ej. 2025-06-13."
            )
            return

        if not descripcion:
            messagebox.showwarning("Falta descripción", "Escribe una descripción.")
            return

        try:
            monto = Decimal(monto_texto)
            if monto <= 0:
                raise InvalidOperation
        except InvalidOperation:
            messagebox.showwarning(
                "Monto inválido",
                "Escribe el monto como un número positivo, sin signo, ej. 199.00.",
            )
            return

        pagina = 0
        if pagina_texto:
            try:
                pagina = int(pagina_texto)
            except ValueError:
                messagebox.showwarning(
                    "Página inválida", "La página debe ser un número entero."
                )
                return

        # linea_cruda deja explícito que este renglón no vino del PDF -- y
        # lo hace único por (fecha, descripción, monto, tipo) para no
        # chocar con el constraint (documento_id, pagina, linea_cruda) del
        # upsert si se agrega más de un renglón manual al mismo documento.
        linea_cruda = f"(manual) {fecha.isoformat()} | {descripcion} | {monto} | {tipo}"

        categoria, comercio = categorizar(descripcion, self.master_app.reglas)
        origen = self.master_app.ruta_pdf_actual.name if self.master_app.ruta_pdf_actual else None

        nueva = TransaccionCanonica(
            fecha=fecha,
            descripcion=descripcion,
            monto=monto,
            tipo=tipo,  # type: ignore[arg-type]
            pagina=pagina,
            linea_cruda=linea_cruda,
            categoria=categoria,
            comercio=comercio,
            tarjeta=tarjeta,
            origen=origen,
        )

        self.master_app.transacciones = [*self.master_app.transacciones, nueva]
        self.master_app._refrescar_tabla()
        self.master_app._actualizar_totales()
        self.master_app.boton_guardar.config(state="normal")

        self.entrada_descripcion.delete(0, "end")
        self.entrada_monto.delete(0, "end")
        self.entrada_pagina.delete(0, "end")
        self.entrada_tarjeta.delete(0, "end")
        messagebox.showinfo(
            "Renglón agregado",
            f"Se agregó: {fecha.isoformat()} · {descripcion} · {tipo} {monto} "
            f"(categoría: {categoria or '(sin categoría)'})",
        )


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

        ttk.Label(marco_superior, text="Banco (se detecta solo si es posible):").pack(
            side="left"
        )
        self.combo_banco = ttk.Combobox(
            marco_superior, values=list(PARSERS), state="readonly", width=20
        )
        self.combo_banco.current(0)
        self.combo_banco.pack(side="left", padx=4)

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
        ttk.Button(
            marco_superior,
            text="Agregar renglón manual...",
            command=self.abrir_renglon_manual,
        ).pack(side="left", padx=(4, 0))

        marco_cuenta = ttk.Frame(self)
        marco_cuenta.pack(fill="x", padx=8, pady=(0, 8))

        ttk.Label(marco_cuenta, text="Alias de cuenta:").pack(side="left")
        self.entrada_alias_cuenta = ttk.Entry(marco_cuenta, width=24)
        self.entrada_alias_cuenta.pack(side="left", padx=4)

        ttk.Label(marco_cuenta, text="Últimos 4 dígitos:").pack(
            side="left", padx=(12, 0)
        )
        self.entrada_ultimos_4 = ttk.Entry(marco_cuenta, width=6)
        self.entrada_ultimos_4.pack(side="left", padx=4)
        ttk.Label(
            marco_cuenta,
            text=(
                "(se autocompleta al cargar el PDF si el extractor lo soporta — "
                "verifica antes de guardar; nunca escribas el número completo)"
            ),
            foreground="#a00",
        ).pack(side="left", padx=8)

        self.tabla = ttk.Treeview(self, columns=COLUMNAS, show="headings")
        encabezados = {
            "pagina": "Pág.",
            "fecha": "Fecha",
            "descripcion": "Descripción",
            "monto": "Monto",
            "tipo": "Tipo",
            "categoria": "Categoría",
            "comercio": "Comercio",
            "tarjeta": "Tarjeta",
            "origen": "Estado de cuenta",
        }
        anchos = {
            "pagina": 40,
            "fecha": 90,
            "descripcion": 280,
            "monto": 90,
            "tipo": 70,
            "categoria": 130,
            "comercio": 110,
            "tarjeta": 80,
            "origen": 160,
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

        marco_acciones_finales = ttk.Frame(self)
        marco_acciones_finales.pack(fill="x", padx=8, pady=8)

        self.boton_sincronizar = ttk.Button(
            marco_acciones_finales,
            text="Sincronizar a Supabase...",
            command=self.sincronizar,
        )
        self.boton_sincronizar.pack(side="right", padx=(8, 0))

        self.boton_guardar = ttk.Button(
            marco_acciones_finales,
            text="Guardar archivo procesado",
            command=self.guardar_procesado,
            state="disabled",
        )
        self.boton_guardar.pack(side="right")

    def _detectar_banco(self, ruta_pdf: Path) -> str | None:
        """Prueba cada extractor registrado contra el PDF. Si exactamente
        uno dice que puede procesarlo, ese es el banco — evita que el
        usuario tenga que elegirlo a mano. Ambigüedad (0 o 2+ matches) cae
        de vuelta a lo que esté seleccionado en el dropdown."""
        coincidencias = []
        for nombre, parser_cls in PARSERS.items():
            try:
                if parser_cls().puede_procesar(ruta_pdf):
                    coincidencias.append(nombre)
            except Exception:  # noqa: BLE001 — un extractor roto no debe tumbar la detección
                continue

        if len(coincidencias) == 1:
            return coincidencias[0]
        return None

    def cargar_pdf(self) -> None:
        ruta_texto = filedialog.askopenfilename(
            title="Selecciona el estado de cuenta",
            filetypes=[("PDF", "*.pdf")],
        )
        if not ruta_texto:
            return
        ruta_pdf = Path(ruta_texto)

        banco_detectado = self._detectar_banco(ruta_pdf)
        if banco_detectado:
            banco = banco_detectado
            self.combo_banco.set(banco)
        else:
            banco = self.combo_banco.get()

        # Respaldo si un extractor necesita año y no lo puede detectar solo
        # del PDF -- no hay campo manual en la UI para esto (ver
        # BanamexParser._detectar_anio: el PDF es la fuente de verdad y la
        # sobreescribe de todos modos cuando la detección funciona).
        anio_respaldo = str(datetime.now().year)
        parser_cls = PARSERS[banco]

        try:
            try:
                # Algunos extractores necesitan el año (el PDF no lo trae
                # impreso en cada renglón); otros no aceptan ese argumento.
                parser = parser_cls(ano_estado_de_cuenta=anio_respaldo)
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

        anio_usado = getattr(parser, "ano_estado_de_cuenta", None)
        anio_detectado_automaticamente = bool(anio_usado) and anio_usado != anio_respaldo
        formato_fecha = getattr(parser, "formato_fecha", "%d/%m/%Y")

        try:
            alias_detectado, ultimos_4_detectados = parser.extraer_info_cuenta(ruta_pdf)
        except Exception:  # noqa: BLE001 — nunca debe tumbar la carga de transacciones
            alias_detectado, ultimos_4_detectados = None, None

        try:
            advertencias_extraccion = parser.advertencias()
        except Exception:  # noqa: BLE001 — nunca debe tumbar la carga de transacciones
            advertencias_extraccion = []

        if alias_detectado:
            self.entrada_alias_cuenta.delete(0, "end")
            self.entrada_alias_cuenta.insert(0, alias_detectado)
        if ultimos_4_detectados:
            self.entrada_ultimos_4.delete(0, "end")
            self.entrada_ultimos_4.insert(0, ultimos_4_detectados)

        if not renglones:
            messagebox.showwarning(
                "Sin transacciones",
                "El extractor no encontró ninguna transacción en este PDF. "
                "¿Elegiste el banco correcto, o el patrón del extractor no "
                "coincide con este formato?",
            )
            return

        transacciones, fallidas = transformar_renglones(renglones, formato_fecha)
        nuevas_transacciones = []
        for t in transacciones:
            categoria, comercio = categorizar(t.descripcion, self.reglas)
            nuevas_transacciones.append(
                replace(t, categoria=categoria, comercio=comercio, origen=ruta_pdf.name)
            )
        transacciones = nuevas_transacciones

        self.transacciones = transacciones
        self.ruta_pdf_actual = ruta_pdf
        self.banco_actual = banco
        self._refrescar_tabla()
        self._actualizar_totales()

        resumen = f"Banco {'detectado' if banco_detectado else 'manual'}: {banco} · {len(transacciones)} transacciones cargadas"
        if fallidas:
            resumen += f" — {len(fallidas)} renglones no se pudieron interpretar (revisa el formato de fecha o el patrón del extractor)"
        if alias_detectado or ultimos_4_detectados:
            resumen += " · cuenta detectada automáticamente, verifícala antes de guardar"
        else:
            resumen += " · no se detectó la cuenta automáticamente, complétala a mano"
        if anio_detectado_automaticamente:
            resumen += f" · año detectado del PDF: {anio_usado}"
        if advertencias_extraccion:
            resumen += f" — {len(advertencias_extraccion)} posible(s) transacción(es) no capturada(s), revisa el PDF"
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

        if advertencias_extraccion:
            detalle_advertencias = "\n".join(f"- {a}" for a in advertencias_extraccion[:10])
            messagebox.showwarning(
                "Posibles transacciones no capturadas",
                f"{len(advertencias_extraccion)} línea(s) del PDF parecen ser una "
                "transacción pero no se pudo leer su contenido completo (a veces el "
                "banco imprime una fila destacada, como un pago recibido, usando una "
                "imagen en vez de texto seleccionable). No se pueden agregar "
                "automáticamente: revísalas contra el PDF impreso y, si corresponde, "
                "captúralas a mano antes de validar el total.\n\n"
                f"{detalle_advertencias}",
            )

    def recategorizar(self) -> None:
        nuevas_transacciones = []
        for t in self.transacciones:
            categoria, comercio = categorizar(t.descripcion, self.reglas)
            nuevas_transacciones.append(replace(t, categoria=categoria, comercio=comercio))
        self.transacciones = nuevas_transacciones
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
                    t.comercio or "",
                    t.tarjeta or "",
                    t.origen or "",
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

    def abrir_renglon_manual(self) -> None:
        if self.ruta_pdf_actual is None:
            messagebox.showwarning(
                "Carga un PDF primero",
                "Un renglón manual se agrega a la tabla de un estado de cuenta ya "
                "cargado (necesita saber a qué documento pertenece) — carga un PDF "
                "primero.",
            )
            return
        VentanaRenglonManual(self)

    def guardar_procesado(self) -> None:
        if not self.transacciones or self.ruta_pdf_actual is None:
            return

        alias = self.entrada_alias_cuenta.get().strip()
        ultimos_4 = self.entrada_ultimos_4.get().strip()
        if not alias:
            messagebox.showwarning(
                "Falta el alias de cuenta",
                "Escribe un alias de cuenta (ej. \"Priority\") antes de guardar — "
                "el esquema de Supabase lo necesita para saber a qué cuenta "
                "pertenece este estado de cuenta.",
            )
            return
        if not (ultimos_4.isdigit() and len(ultimos_4) == 4):
            messagebox.showwarning(
                "Últimos 4 dígitos inválidos",
                "Escribe exactamente los últimos 4 dígitos de la cuenta (solo "
                "números) — nunca el número completo.",
            )
            return

        documento_hash = _hash_pdf(self.ruta_pdf_actual)
        self.ruta_pdf_actual = self._mover_a_procesados_junto_al_pdf(self.ruta_pdf_actual)

        salida = {
            "banco": self.banco_actual,
            "cuenta_alias": alias,
            "cuenta_ultimos_4_digitos": ultimos_4,
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
                    "comercio": t.comercio,
                    "tarjeta": t.tarjeta,
                    "origen": t.origen,
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
            f"El PDF original se movió a:\n{self.ruta_pdf_actual}\n\n"
            "Usa \"Sincronizar a Supabase...\" para subirlo (y cualquier otro "
            "archivo pendiente en data/procesados/).",
        )

    def _mover_a_procesados_junto_al_pdf(self, ruta_pdf: Path) -> Path:
        """Mueve el PDF ya guardado a una subcarpeta "procesados" dentro de
        la misma carpeta donde estaba (no la carpeta data/procesados/ del
        proyecto, esa es para los JSON exportados) — para llevar registro
        de qué estados de cuenta ya se cargaron sin tener que abrir cada
        JSON. Reutiliza la carpeta si ya existe; no la vuelve a crear."""
        if ruta_pdf.parent.name == "procesados":
            # Ya está adentro de una carpeta "procesados" (ej. lo volviste
            # a cargar desde ahí para corregir algo) -- no lo anides de nuevo.
            return ruta_pdf

        carpeta_destino = ruta_pdf.parent / "procesados"
        try:
            carpeta_destino.mkdir(exist_ok=True)
        except OSError:
            return ruta_pdf  # sin permisos u otra falla -- se queda donde estaba

        destino = carpeta_destino / ruta_pdf.name
        if destino.exists() and destino != ruta_pdf:
            # No pisar un archivo distinto que ya tenga ese nombre ahí.
            contador = 1
            while destino.exists():
                destino = carpeta_destino / f"{ruta_pdf.stem} ({contador}){ruta_pdf.suffix}"
                contador += 1

        try:
            return ruta_pdf.replace(destino)
        except OSError:
            return ruta_pdf

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

    def sincronizar(self) -> None:
        if not messagebox.askyesno(
            "Sincronizar a Supabase",
            "Esto sube todos los archivos pendientes en data/procesados/ a tu "
            "proyecto de Supabase (autenticado como tú, vía .env). ¿Continuar?",
        ):
            return

        try:
            from dotenv import load_dotenv

            from sync.sincronizador import (
                NOMBRE_ARCHIVO_ESTADO_SYNC,
                crear_cliente_autenticado,
                sincronizar_todos,
            )
        except ImportError as error:
            messagebox.showerror(
                "Faltan dependencias",
                f"No se pudo importar el Sincronizador: {error}\n\n"
                "Instala las dependencias de sincronización:\n"
                "pip install -r requirements.txt",
            )
            return

        load_dotenv()
        try:
            client = crear_cliente_autenticado()
        except KeyError as error:
            messagebox.showerror(
                "Falta configuración en .env",
                f"Falta la variable {error} en tu archivo .env. Revisa "
                "SUPABASE_URL, SUPABASE_KEY, SUPABASE_EMAIL y SUPABASE_PASSWORD.",
            )
            return
        except Exception as error:  # noqa: BLE001 — típicamente login inválido
            messagebox.showerror(
                "No se pudo iniciar sesión en Supabase",
                f"{error}\n\nRevisa SUPABASE_EMAIL/SUPABASE_PASSWORD en tu .env.",
            )
            return

        resultados = sincronizar_todos(client)
        if not resultados:
            hay_archivos = any(
                p.name != NOMBRE_ARCHIVO_ESTADO_SYNC
                for p in CARPETA_PROCESADOS.glob("*.json")
            )
            mensaje = (
                "Ya estaba todo sincronizado — no había archivos nuevos ni "
                "modificados desde la última vez."
                if hay_archivos
                else "No hay archivos en data/procesados/."
            )
            messagebox.showinfo("Sincronizar a Supabase", mensaje)
            return

        exitosos = [r for r in resultados if r.ok]
        fallidos = [r for r in resultados if not r.ok]
        total_transacciones = sum(r.transacciones_sincronizadas for r in exitosos)

        resumen = (
            f"{len(exitosos)}/{len(resultados)} archivo(s) nuevos/modificados "
            f"sincronizados ({total_transacciones} transacciones).\n"
        )
        if fallidos:
            detalle = "\n".join(f"- {r.archivo}: {r.error}" for r in fallidos)
            messagebox.showwarning(
                "Sincronización con errores", resumen + "\nFallaron:\n" + detalle
            )
        else:
            messagebox.showinfo("Sincronización completa", resumen)


def main() -> None:
    App().mainloop()


if __name__ == "__main__":
    main()
