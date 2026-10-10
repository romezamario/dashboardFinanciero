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

import json
import tkinter as tk
import tkinter.font as tkfont
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from app.hilos import correr_en_hilo
from app.logica import (
    PREFIJO_RENGLON_MANUAL,
    ErrorDeExtraccion,
    LecturaPdf,
    aplicar_categorias_manuales,
    hash_pdf,
    leer_estado_de_cuenta,
    mover_a_procesados_junto_al_pdf,
)
from parsers.base import BaseParser
from parsers.ejemplo import EjemploParser
from parsers.banamex import BanamexParser
from parsers.banamex_tdc import BanamexTdcParser
from parsers.invex_tdc import InvexTdcParser
from app.pestana_gmail import PestanaGastosGmail
from app.sugerencias import sugerir_reglas_con_ia
from app.ventanas import (
    VentanaCategoriaManual,
    VentanaInspeccion,
    VentanaReglas,
    VentanaRenglonManual,
)
from transform.categorizador import Regla, cargar_reglas, categorizar, guardar_reglas
from transform.transformador import TransaccionCanonica

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

# Colores de apoyo de la interfaz (el resto lo pone el tema nativo de Windows).
COLOR_TEXTO_SECUNDARIO = "#5f6368"
COLOR_FILA_PAR = "#f6f8fa"
COLOR_FONDO_MANUAL = "#fff4cc"
COLOR_FONDO_MANUAL_TEXTO = "#b38600"  # el mismo amarillo, legible como texto
COLOR_SIN_CATEGORIA = "#b3261e"
COLOR_ABONO = "#1b7a3a"

# "origen" (estado de cuenta) se sigue guardando en el JSON, pero no se muestra:
# el usuario no lo usa (2026-10-05).
COLUMNAS = ("pagina", "fecha", "descripcion", "monto", "tipo", "categoria", "comercio", "tarjeta")

# Debe coincidir exactamente con la categoría de esa regla en
# transform/reglas_categorizacion.json — así el panel de totales puede
# separarla del resto de los cargos.
CATEGORIA_DISPOSICION_EFECTIVO = "Disposición de efectivo"

class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Dashboard Financiero — revisión de estados de cuenta")
        self.geometry("1240x780")
        self.minsize(980, 600)

        self.reglas: list[Regla] = cargar_reglas()
        self.transacciones: list[TransaccionCanonica] = []
        self.ruta_pdf_actual: Path | None = None
        self.banco_actual: str | None = None
        # El extractor de la última carga: VentanaRenglonManual le pregunta
        # cómo reescribe descripciones antes de categorizar.
        self.parser_actual: BaseParser | None = None
        # (fecha ISO, página, tarjeta) de cada línea que el extractor detectó
        # como faltante en la última carga -- valores por defecto de
        # VentanaRenglonManual.
        self.sugerencias_renglon_manual: list[tuple[str, int | None, str | None]] = []
        # Categoría/comercio puestos a mano en renglones extraídos del PDF
        # (VentanaCategoriaManual), por su llave (pagina, linea_cruda) -- la
        # misma del upsert, así que es única dentro del documento. Las reglas
        # nunca los pisan (recategorizar) y se guardan en el JSON.
        self.categorias_manuales: dict[tuple[int, str], tuple[str, str | None]] = {}
        # Hay un PDF leyéndose o una sincronización en curso (en un hilo).
        self._ocupado = False
        # Claude está pensando las propuestas de reglas (en un hilo).
        self._pidiendo_sugerencias = False
        self.descripciones_sin_categoria: list[str] = []

        self._construir_ui()
        # Opcional (casilla en la pestaña de Gmail, apagada por defecto).
        self.after(500, self.pestana_gmail.revisar_al_abrir)

    def _configurar_estilos(self) -> None:
        """Tipografía y estilos compartidos. Se queda con el tema nativo de
        Windows ("vista"); solo ajusta tamaños, pesos y colores de apoyo."""
        for nombre in ("TkDefaultFont", "TkTextFont", "TkMenuFont", "TkHeadingFont"):
            try:
                tkfont.nametofont(nombre).configure(family="Segoe UI", size=9)
            except tk.TclError:
                pass
        estilo = ttk.Style(self)
        estilo.configure("Treeview", rowheight=22)
        estilo.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"))
        estilo.configure("Primario.TButton", font=("Segoe UI", 9, "bold"), padding=(10, 3))
        estilo.configure("Ayuda.TLabel", foreground=COLOR_TEXTO_SECUNDARIO)
        estilo.configure("Seccion.TLabel", font=("Segoe UI", 9, "bold"))
        estilo.configure("TotalTitulo.TLabel", foreground=COLOR_TEXTO_SECUNDARIO, font=("Segoe UI", 8))
        estilo.configure("TotalValor.TLabel", font=("Segoe UI", 11, "bold"))
        estilo.configure("Vacio.TLabel", foreground=COLOR_TEXTO_SECUNDARIO, font=("Segoe UI", 10))

    def _construir_ui(self) -> None:
        self._configurar_estilos()

        # Orden de empaquetado: primero lo de arriba y lo de abajo, al final las
        # pestañas con expand=True -- así la tabla se queda con el espacio que
        # sobra y nunca empuja fuera de la ventana los botones de Guardar y
        # Sincronizar (antes quedaban aplastados con la ventana chica).
        self._construir_encabezado()
        self._construir_pie()

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=(4, 0))

        pestana_transacciones = ttk.Frame(self.notebook, padding=(0, 6, 0, 0))
        self.notebook.add(pestana_transacciones, text="Transacciones")
        self._construir_tabla(pestana_transacciones)

        # Pestaña separada (no solo un filtro de la tabla) para que las
        # descripciones sin categoría queden en texto plano, una por línea,
        # listas para copiar y pegar directo en el chat con Claude y pedir
        # una propuesta de reglas -- pedido explícito del usuario
        # (2026-09-26) en vez de tener que tomar capturas de pantalla de la
        # tabla como se venía haciendo. Únicas y sin acentos/orden de
        # aparición alterado: no tiene caso pegar la misma descripción
        # repetida 20 veces si "Uber" apareció 20 veces sin categorizar.
        self.pestana_sin_categorizar = ttk.Frame(self.notebook)
        self.notebook.add(self.pestana_sin_categorizar, text="Sin categorizar")

        marco_sin_categorizar_top = ttk.Frame(self.pestana_sin_categorizar)
        marco_sin_categorizar_top.pack(fill="x", padx=8, pady=(8, 4))
        self.etiqueta_sin_categorizar = ttk.Label(
            marco_sin_categorizar_top, text="Sin datos cargados."
        )
        self.etiqueta_sin_categorizar.pack(side="left")
        ttk.Button(
            marco_sin_categorizar_top,
            text="Copiar todo",
            command=self._copiar_sin_categorizar,
        ).pack(side="right")
        # Pide a Claude Code (la CLI, con la suscripción del usuario) una
        # propuesta de reglas -- lo que antes se hacía pegando esta lista en un
        # chat. Ver transform/sugerencias_ia.py y VentanaSugerenciasIA.
        self.boton_sugerir_ia = ttk.Button(
            marco_sin_categorizar_top,
            text="Sugerir reglas con Claude...",
            style="Primario.TButton",
            command=self.sugerir_reglas_con_ia,
            state="disabled",
        )
        self.boton_sugerir_ia.pack(side="right", padx=(0, 6))

        self.texto_sin_categorizar = tk.Text(
            self.pestana_sin_categorizar, wrap="none", height=10, state="disabled",
            font=("Consolas", 9), relief="flat", borderwidth=1,
        )
        self.texto_sin_categorizar.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        # Avisos de compra de Banamex leídos de Gmail: independiente del PDF
        # cargado (son otra fuente y otra tabla de Supabase, `gastos_correo`).
        self.pestana_gmail = PestanaGastosGmail(self.notebook)
        self.notebook.add(self.pestana_gmail, text="Gastos recientes (Gmail)")

    def _construir_encabezado(self) -> None:
        # Renglón 1: el flujo principal (banco -> cargar PDF) a la izquierda,
        # las reglas (afectan a todo, no solo a este PDF) a la derecha.
        barra = ttk.Frame(self, padding=(10, 10, 10, 4))
        barra.pack(fill="x")

        ttk.Label(barra, text="Banco:").pack(side="left")
        self.combo_banco = ttk.Combobox(barra, values=list(PARSERS), state="readonly", width=16)
        self.combo_banco.current(0)
        self.combo_banco.pack(side="left", padx=(4, 8))
        self.boton_cargar_pdf = ttk.Button(
            barra, text="Cargar PDF...", style="Primario.TButton", command=self.cargar_pdf
        )
        self.boton_cargar_pdf.pack(side="left")
        ttk.Button(barra, text="Inspeccionar PDF...", command=self.abrir_inspeccion).pack(
            side="left", padx=(6, 0)
        )
        ttk.Label(barra, text="se detecta solo al cargar", style="Ayuda.TLabel").pack(
            side="left", padx=(10, 0)
        )

        ttk.Button(barra, text="Recargar reglas", command=self.recargar_reglas).pack(side="right")
        ttk.Button(
            barra, text="Reglas de categorización...", command=self.abrir_reglas
        ).pack(side="right", padx=(0, 6))

        # Renglón 2: la cuenta a la que se asocia este estado de cuenta.
        cuenta = ttk.Frame(self, padding=(10, 2, 10, 4))
        cuenta.pack(fill="x")
        ttk.Label(cuenta, text="Cuenta:", style="Seccion.TLabel").pack(side="left")
        ttk.Label(cuenta, text="Alias").pack(side="left", padx=(10, 4))
        self.entrada_alias_cuenta = ttk.Entry(cuenta, width=22)
        self.entrada_alias_cuenta.pack(side="left")
        ttk.Label(cuenta, text="Últimos 4 dígitos").pack(side="left", padx=(14, 4))
        self.entrada_ultimos_4 = ttk.Entry(cuenta, width=6)
        self.entrada_ultimos_4.pack(side="left")
        ttk.Label(
            cuenta,
            text="Se llenan al cargar el PDF: verifícalos antes de guardar. Nunca escribas el número completo.",
            style="Ayuda.TLabel",
        ).pack(side="left", padx=(12, 0))

        ttk.Separator(self).pack(fill="x", padx=10, pady=(4, 0))

    def _construir_tabla(self, padre: ttk.Frame) -> None:
        marco_acciones_tabla = ttk.Frame(padre)
        marco_acciones_tabla.pack(side="bottom", fill="x", pady=(6, 0))
        ttk.Button(
            marco_acciones_tabla,
            text="Agregar renglón manual...",
            command=self.abrir_renglon_manual,
        ).pack(side="left")
        self.boton_editar_manual = ttk.Button(
            marco_acciones_tabla,
            text="Editar...",
            command=self.editar_seleccion,
            state="disabled",
        )
        self.boton_editar_manual.pack(side="left", padx=(6, 0))
        self.boton_eliminar_manual = ttk.Button(
            marco_acciones_tabla,
            text="Eliminar",
            command=self.eliminar_renglon_manual,
            state="disabled",
        )
        self.boton_eliminar_manual.pack(side="left", padx=(6, 0))
        ttk.Label(
            marco_acciones_tabla,
            text="■ renglón manual",
            foreground=COLOR_FONDO_MANUAL_TEXTO,
        ).pack(side="left", padx=(14, 0))
        ttk.Label(
            marco_acciones_tabla, text="■ abono", foreground=COLOR_ABONO
        ).pack(side="left", padx=(10, 0))
        ttk.Label(
            marco_acciones_tabla, text="■ sin categoría", foreground=COLOR_SIN_CATEGORIA
        ).pack(side="left", padx=(10, 0))
        ttk.Label(
            marco_acciones_tabla, text="✎ categoría puesta a mano", style="Ayuda.TLabel"
        ).pack(side="left", padx=(10, 0))
        ttk.Label(
            marco_acciones_tabla,
            text="Doble clic: editar · clic en un encabezado: ordenar",
            style="Ayuda.TLabel",
        ).pack(side="right")

        marco_tabla = ttk.Frame(padre)
        marco_tabla.pack(fill="both", expand=True)
        self.tabla = ttk.Treeview(marco_tabla, columns=COLUMNAS, show="headings")
        encabezados = {
            "pagina": "Pág.",
            "fecha": "Fecha",
            "descripcion": "Descripción",
            "monto": "Monto",
            "tipo": "Tipo",
            "categoria": "Categoría",
            "comercio": "Comercio",
            "tarjeta": "Tarjeta",
        }
        # (ancho, alineación, ¿crece con la ventana?)
        columnas = {
            "pagina": (48, "center", False),
            "fecha": (96, "w", False),
            "descripcion": (320, "w", True),
            "monto": (110, "e", False),
            "tipo": (80, "center", False),
            "categoria": (150, "w", False),
            "comercio": (140, "w", False),
            "tarjeta": (80, "w", False),
        }
        for col in COLUMNAS:
            ancho, alineacion, crece = columnas[col]
            self.tabla.heading(
                col, text=encabezados[col], anchor=alineacion,
                command=lambda c=col: self._ordenar_tabla(c),
            )
            self.tabla.column(col, width=ancho, minwidth=40, anchor=alineacion, stretch=crece)
        # Primero el rayado, después lo que debe destacar encima de él.
        self.tabla.tag_configure("par", background=COLOR_FILA_PAR)
        self.tabla.tag_configure("abono", foreground=COLOR_ABONO)
        self.tabla.tag_configure("sin_categoria", foreground=COLOR_SIN_CATEGORIA)
        # Los renglones manuales se distinguen a simple vista: son los únicos
        # que se pueden editar/eliminar (los extraídos vienen del PDF).
        self.tabla.tag_configure("manual", background=COLOR_FONDO_MANUAL)
        # Solo si el doble clic cae sobre un renglón (no en los encabezados).
        self.tabla.bind(
            "<Double-1>",
            lambda e: self.tabla.identify_row(e.y) and self.editar_seleccion(),
        )
        self.tabla.bind("<<TreeviewSelect>>", lambda _e: self._actualizar_botones_manual())

        barra_v = ttk.Scrollbar(marco_tabla, orient="vertical", command=self.tabla.yview)
        barra_h = ttk.Scrollbar(marco_tabla, orient="horizontal", command=self.tabla.xview)
        self.tabla.configure(yscrollcommand=barra_v.set, xscrollcommand=barra_h.set)
        self.tabla.grid(row=0, column=0, sticky="nsew")
        barra_v.grid(row=0, column=1, sticky="ns")
        barra_h.grid(row=1, column=0, sticky="ew")
        marco_tabla.rowconfigure(0, weight=1)
        marco_tabla.columnconfigure(0, weight=1)

        # Estado vacío: encima de la tabla mientras no haya nada cargado.
        self.etiqueta_tabla_vacia = ttk.Label(
            marco_tabla,
            text="Elige el banco (o déjalo detectar) y presiona «Cargar PDF...» para empezar.",
            style="Vacio.TLabel",
            background="white",
        )
        self.etiqueta_tabla_vacia.place(relx=0.5, rely=0.45, anchor="center")
        self._orden_tabla: tuple[str, bool] | None = None

    def _construir_pie(self) -> None:
        pie = ttk.Frame(self, padding=(10, 6, 10, 10))
        pie.pack(side="bottom", fill="x")

        ttk.Separator(pie).pack(fill="x", pady=(0, 6))
        self.etiqueta_resumen = ttk.Label(pie, text="Sin datos cargados.", style="Ayuda.TLabel")
        self.etiqueta_resumen.pack(fill="x")
        # El resumen puede ser largo (advertencias, manuales recuperados...):
        # que se ajuste al ancho en vez de cortarse.
        pie.bind(
            "<Configure>",
            lambda e: self.etiqueta_resumen.configure(wraplength=max(e.width - 20, 200)),
        )

        fila = ttk.Frame(pie)
        fila.pack(fill="x", pady=(6, 0))

        self.etiquetas_totales: dict[str, tuple[ttk.Label, ttk.Label]] = {}
        for clave, titulo in (
            ("cargos", "Cargos"),
            ("efectivo", "Disposición de efectivo"),
            ("abonos", "Abonos"),
        ):
            tarjeta = ttk.Frame(fila, padding=(0, 0, 28, 0))
            tarjeta.pack(side="left")
            ttk.Label(tarjeta, text=titulo, style="TotalTitulo.TLabel").pack(anchor="w")
            valor = ttk.Label(tarjeta, text="—", style="TotalValor.TLabel")
            valor.pack(anchor="w")
            detalle = ttk.Label(tarjeta, text="", style="TotalTitulo.TLabel")
            detalle.pack(anchor="w")
            self.etiquetas_totales[clave] = (valor, detalle)

        self.boton_sincronizar = ttk.Button(
            fila,
            text="Sincronizar a Supabase...",
            command=self.sincronizar,
        )
        self.boton_sincronizar.pack(side="right", padx=(8, 0))

        self.boton_guardar = ttk.Button(
            fila,
            text="Guardar archivo procesado",
            style="Primario.TButton",
            command=self.guardar_procesado,
            state="disabled",
        )
        self.boton_guardar.pack(side="right")

    def _ordenar_tabla(self, columna: str) -> None:
        """Ordena lo que se ve (no `self.transacciones`): los iid siguen siendo
        la posición en la lista, así que editar/eliminar no se afecta."""
        descendente = self._orden_tabla == (columna, False)
        self._orden_tabla = (columna, descendente)

        def clave(iid: str):
            t = self.transacciones[int(iid)]
            valor = {
                "pagina": t.pagina, "fecha": t.fecha, "descripcion": t.descripcion.upper(),
                "monto": t.monto, "tipo": t.tipo, "categoria": (t.categoria or "").upper(),
                "comercio": (t.comercio or "").upper(), "tarjeta": t.tarjeta or "",
            }[columna]
            return (valor, int(iid))

        for posicion, iid in enumerate(sorted(self.tabla.get_children(), key=clave, reverse=descendente)):
            self.tabla.move(iid, "", posicion)
        self._rayar_tabla()
        flecha = " ▼" if descendente else " ▲"
        for col in COLUMNAS:
            texto = self.tabla.heading(col, "text").rstrip(" ▲▼")
            self.tabla.heading(col, text=texto + (flecha if col == columna else ""))

    def _rayar_tabla(self) -> None:
        """Filas alternadas según el orden visible (cambia al ordenar)."""
        for posicion, iid in enumerate(self.tabla.get_children()):
            etiquetas = [e for e in self.tabla.item(iid, "tags") if e != "par"]
            if posicion % 2:
                etiquetas.insert(0, "par")
            self.tabla.item(iid, tags=etiquetas)

    def _actualizar_botones_manual(self) -> None:
        seleccion = self.tabla.selection()
        # Editar: cualquier renglón (los del PDF, solo su categoría). Eliminar:
        # solo un renglón manual.
        self.boton_editar_manual.config(state="normal" if seleccion else "disabled")
        es_manual = len(seleccion) == 1 and self.transacciones[int(seleccion[0])].linea_cruda.startswith(
            PREFIJO_RENGLON_MANUAL
        )
        self.boton_eliminar_manual.config(state="normal" if es_manual else "disabled")

    def _marcar_ocupado(self, ocupado: bool, mensaje: str | None = None) -> None:
        """Mientras se lee un PDF o se sincroniza (en un hilo, ver app/hilos.py)
        la ventana sigue respondiendo, pero los botones que cambiarían lo que
        ese trabajo está usando se deshabilitan y el cursor queda en espera."""
        self._ocupado = ocupado
        estado = "disabled" if ocupado else "normal"
        for boton in (self.boton_cargar_pdf, self.boton_sincronizar):
            boton.config(state=estado)
        if ocupado:
            self.boton_guardar.config(state="disabled")
        elif self.ruta_pdf_actual is not None and self.transacciones:
            self.boton_guardar.config(state="normal")
        self.config(cursor="watch" if ocupado else "")
        if mensaje is not None:
            self.etiqueta_resumen.config(text=mensaje)

    def cargar_pdf(self) -> None:
        if self._ocupado:
            return
        ruta_texto = filedialog.askopenfilename(
            title="Selecciona el estado de cuenta",
            filetypes=[("PDF", "*.pdf")],
        )
        if not ruta_texto:
            return
        ruta_pdf = Path(ruta_texto)
        banco_manual = self.combo_banco.get()
        reglas = list(self.reglas)

        # Extraer (sobre todo con filas en imagen, ver parsers/glifos.py) puede
        # tardar varios segundos: en un hilo, para que la ventana no se congele.
        resumen_anterior = self.etiqueta_resumen.cget("text")
        self._marcar_ocupado(True, f"Leyendo {ruta_pdf.name}…")
        correr_en_hilo(
            self,
            lambda _progreso: leer_estado_de_cuenta(
                ruta_pdf, banco_manual, reglas, PARSERS, CARPETA_PROCESADOS
            ),
            lambda lectura: self._al_leer_pdf(lectura, resumen_anterior),
            lambda error: self._al_fallar_lectura(ruta_pdf, error, resumen_anterior),
        )

    def _al_fallar_lectura(self, ruta_pdf: Path, error: Exception, resumen_anterior: str) -> None:
        # Lo que estaba cargado antes sigue en la tabla: se restaura su resumen.
        self._marcar_ocupado(False, resumen_anterior)
        banco = error.banco if isinstance(error, ErrorDeExtraccion) else self.combo_banco.get()
        self._mover_a_errores(ruta_pdf, str(error))
        messagebox.showerror(
            "Error al extraer",
            f"No se pudo leer el PDF con el extractor de {banco}:\n{error}\n\n"
            f"El archivo se movió a {CARPETA_ERRORES}.",
        )

    def _al_leer_pdf(self, lectura: LecturaPdf, resumen_anterior: str) -> None:
        self._marcar_ocupado(False, resumen_anterior)
        ruta_pdf = lectura.ruta_pdf
        if lectura.banco_detectado:
            self.combo_banco.set(lectura.banco)

        # Siempre se limpian primero: si este PDF no trae la cuenta
        # detectable, dejar los valores del PDF cargado ANTES haría que "Guardar"
        # atribuyera este estado de cuenta a la cuenta equivocada sin aviso
        # (el resumen ya pide "complétala a mano" en ese caso).
        self.entrada_alias_cuenta.delete(0, "end")
        self.entrada_ultimos_4.delete(0, "end")
        if lectura.alias_detectado:
            self.entrada_alias_cuenta.insert(0, lectura.alias_detectado)
        if lectura.ultimos_4_detectados:
            self.entrada_ultimos_4.insert(0, lectura.ultimos_4_detectados)

        if not lectura.hay_renglones:
            messagebox.showwarning(
                "Sin transacciones",
                "El extractor no encontró ninguna transacción en este PDF. "
                "¿Elegiste el banco correcto, o el patrón del extractor no "
                "coincide con este formato?",
            )
            return

        self.transacciones = lectura.transacciones
        self.categorias_manuales = lectura.categorias_manuales
        self.ruta_pdf_actual = ruta_pdf
        self.banco_actual = lectura.banco
        self.parser_actual = lectura.parser
        self.sugerencias_renglon_manual = lectura.sugerencias_manuales
        self._refrescar_tabla()
        self._actualizar_totales()

        fallidas = lectura.fallidas
        advertencias_extraccion = lectura.advertencias
        resumen = (
            f"Banco {'detectado' if lectura.banco_detectado else 'manual'}: {lectura.banco} · "
            f"{len(lectura.transacciones)} transacciones cargadas"
        )
        if fallidas:
            resumen += f" — {len(fallidas)} renglones no se pudieron interpretar (revisa el formato de fecha o el patrón del extractor)"
        if lectura.alias_detectado or lectura.ultimos_4_detectados:
            resumen += " · cuenta detectada automáticamente, verifícala antes de guardar"
        else:
            resumen += " · no se detectó la cuenta automáticamente, complétala a mano"
        if lectura.anio_detectado:
            resumen += f" · año detectado del PDF: {lectura.anio_detectado}"
        if lectura.manuales_recuperados:
            resumen += f" · {lectura.manuales_recuperados} renglón(es) manual(es) recuperado(s) de la carga anterior"
        if lectura.ya_capturadas:
            resumen += (
                f" ({lectura.ya_capturadas} fila(s) que ahora sí se leen del PDF ya estaban "
                "capturadas a mano: se conserva el renglón manual)"
            )
        if advertencias_extraccion:
            resumen += f" — {len(advertencias_extraccion)} posible(s) transacción(es) no capturada(s), revisa el PDF"
        self.etiqueta_resumen.config(text=resumen)
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
                "captúralas a mano con \"Agregar renglón manual...\".\n\n"
                f"{detalle_advertencias}",
            )

    def recategorizar(self) -> None:
        nuevas_transacciones = []
        for t in self.transacciones:
            categoria, comercio = categorizar(t.descripcion, self.reglas)
            if categoria is None and t.linea_cruda.startswith(PREFIJO_RENGLON_MANUAL):
                # Un renglón manual puede traer categoría elegida a mano en el
                # diálogo; si ya ninguna regla lo cubre, no se le borra.
                categoria, comercio = t.categoria, t.comercio
            nuevas_transacciones.append(replace(t, categoria=categoria, comercio=comercio))
        self.transacciones = self._aplicar_categorias_manuales(nuevas_transacciones)
        self._refrescar_tabla()
        self._actualizar_totales()

    def tiene_categoria_manual(self, t: TransaccionCanonica) -> bool:
        return (t.pagina, t.linea_cruda) in self.categorias_manuales

    def _aplicar_categorias_manuales(
        self, transacciones: list[TransaccionCanonica]
    ) -> list[TransaccionCanonica]:
        return aplicar_categorias_manuales(transacciones, self.categorias_manuales)

    def asignar_categoria_manual(self, indices: list[int], categoria: str, comercio: str | None) -> None:
        for i in indices:
            t = self.transacciones[i]
            if t.linea_cruda.startswith(PREFIJO_RENGLON_MANUAL):
                # Un renglón tecleado ya conserva su categoría por sí solo.
                self.transacciones[i] = replace(t, categoria=categoria, comercio=comercio)
            else:
                self.categorias_manuales[(t.pagina, t.linea_cruda)] = (categoria, comercio)
        self.transacciones = self._aplicar_categorias_manuales(self.transacciones)
        self._despues_de_cambiar_categorias(indices)

    def quitar_categoria_manual(self, indices: list[int]) -> None:
        for i in indices:
            t = self.transacciones[i]
            self.categorias_manuales.pop((t.pagina, t.linea_cruda), None)
            if not t.linea_cruda.startswith(PREFIJO_RENGLON_MANUAL):
                categoria, comercio = categorizar(t.descripcion, self.reglas)
                self.transacciones[i] = replace(t, categoria=categoria, comercio=comercio)
        self._despues_de_cambiar_categorias(indices)

    def _despues_de_cambiar_categorias(self, indices: list[int]) -> None:
        orden = self._orden_tabla
        self._refrescar_tabla()
        if orden is not None:  # se queda como el usuario la tenía ordenada
            self._orden_tabla = (orden[0], not orden[1])
            self._ordenar_tabla(orden[0])
        self._actualizar_totales()
        self.boton_guardar.config(state="normal")
        visibles = [str(i) for i in indices if self.tabla.exists(str(i))]
        if visibles:
            self.tabla.selection_set(visibles)
            self.tabla.see(visibles[0])

    def _refrescar_tabla(self) -> None:
        self.tabla.delete(*self.tabla.get_children())
        for indice, t in enumerate(self.transacciones):
            categoria = t.categoria or "(sin categoría)"
            if self.tiene_categoria_manual(t):
                categoria = f"✎ {categoria}"
            etiquetas = []
            if t.categoria is None:
                etiquetas.append("sin_categoria")  # el rojo gana: pide atención
            elif t.tipo == "abono":
                etiquetas.append("abono")
            if t.linea_cruda.startswith(PREFIJO_RENGLON_MANUAL):
                etiquetas.append("manual")
            self.tabla.insert(
                "",
                "end",
                # iid = posición en self.transacciones, para saber qué renglón
                # se seleccionó (_renglon_manual_seleccionado).
                iid=str(indice),
                tags=etiquetas,
                values=(
                    t.pagina,
                    t.fecha.isoformat(),
                    t.descripcion,
                    f"{t.monto:,.2f}",
                    t.tipo,
                    categoria,
                    t.comercio or "",
                    t.tarjeta or "",
                ),
            )
        # Recién cargada, la tabla va en el orden del PDF (sin flecha de orden).
        self._orden_tabla = None
        for col in COLUMNAS:
            self.tabla.heading(col, text=self.tabla.heading(col, "text").rstrip(" ▲▼"))
        self._rayar_tabla()
        if self.transacciones:
            self.etiqueta_tabla_vacia.place_forget()
        else:
            self.etiqueta_tabla_vacia.place(relx=0.5, rely=0.45, anchor="center")
        self._actualizar_botones_manual()
        self._refrescar_sin_categorizar()

    def _refrescar_sin_categorizar(self) -> None:
        # Únicas y en orden de primera aparición -- ver el porqué en el
        # comentario de la pestaña, junto a donde se crea self.texto_sin_categorizar.
        descripciones_unicas: list[str] = []
        vistas: set[str] = set()
        for t in self.transacciones:
            if t.categoria is None and t.descripcion not in vistas:
                vistas.add(t.descripcion)
                descripciones_unicas.append(t.descripcion)

        self.texto_sin_categorizar.config(state="normal")
        self.texto_sin_categorizar.delete("1.0", "end")
        self.texto_sin_categorizar.insert("1.0", "\n".join(descripciones_unicas))
        self.texto_sin_categorizar.config(state="disabled")

        if not self.transacciones:
            texto_etiqueta = "Sin datos cargados."
        elif descripciones_unicas:
            texto_etiqueta = f"{len(descripciones_unicas)} descripción(es) única(s) sin categoría."
        else:
            texto_etiqueta = "Todas las transacciones tienen categoría."
        self.etiqueta_sin_categorizar.config(text=texto_etiqueta)
        self.descripciones_sin_categoria = descripciones_unicas
        if not self._pidiendo_sugerencias:
            self.boton_sugerir_ia.config(state="normal" if descripciones_unicas else "disabled")
        self.notebook.tab(
            self.pestana_sin_categorizar,
            text=f"Sin categorizar ({len(descripciones_unicas)})" if descripciones_unicas else "Sin categorizar",
        )

    def sugerir_reglas_con_ia(self) -> None:
        """Ver app/sugerencias.py."""
        sugerir_reglas_con_ia(self)

    def agregar_reglas(self, nuevas: list[Regla], parent: tk.Misc | None = None) -> bool:
        """Agrega `nuevas` al final de reglas_categorizacion.json (al final:
        solo atrapan lo que hoy no tiene categoría, nunca cambian lo ya
        categorizado) y recategoriza lo cargado. True si se guardaron."""
        parent = parent or self
        if any(isinstance(w, VentanaReglas) for w in self.winfo_children()):
            messagebox.showwarning(
                "Cierra el editor de reglas",
                "La ventana \"Reglas de categorización\" está abierta: ciérrala primero "
                "(al guardar ahí reemplazaría el archivo con su copia).",
                parent=parent,
            )
            return False
        try:
            # Del disco, no self.reglas: por si el archivo se editó fuera de la app.
            reglas = cargar_reglas()
        except (OSError, ValueError, KeyError, TypeError) as error:
            messagebox.showerror("No se pudieron leer las reglas", str(error), parent=parent)
            return False
        existentes = {r.patron.upper() for r in reglas}
        agregadas = [r for r in nuevas if r.patron.upper() not in existentes]
        try:
            guardar_reglas(reglas + agregadas)
        except OSError as error:
            messagebox.showerror("No se pudieron guardar las reglas", str(error), parent=parent)
            return False
        self.reglas = reglas + agregadas
        sin_categoria_antes = sum(1 for t in self.transacciones if t.categoria is None)
        if self.transacciones:
            self.recategorizar()
            self.boton_guardar.config(state="normal")
        sin_categoria = sum(1 for t in self.transacciones if t.categoria is None)
        messagebox.showinfo(
            "Reglas agregadas",
            f"{len(agregadas)} regla(s) nueva(s). Sin categoría: {sin_categoria_antes} → "
            f"{sin_categoria}.\n\nGuarda el archivo procesado para conservar los cambios.",
            parent=parent,
        )
        return True

    def _copiar_sin_categorizar(self) -> None:
        self.clipboard_clear()
        self.clipboard_append(self.texto_sin_categorizar.get("1.0", "end-1c"))

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

        for clave, valor, cuantos in (
            ("cargos", total_otros_cargos, len(otros_cargos)),
            ("efectivo", total_efectivo, len(cargos_efectivo)),
            ("abonos", total_abonos, len(abonos)),
        ):
            etiqueta_valor, etiqueta_detalle = self.etiquetas_totales[clave]
            etiqueta_valor.config(text=f"${valor:,.2f}" if self.transacciones else "—")
            etiqueta_detalle.config(text=f"{cuantos} movimiento(s)" if self.transacciones else "")

    def abrir_reglas(self) -> None:
        VentanaReglas(self)

    def recargar_reglas(self) -> None:
        """Vuelve a leer reglas_categorizacion.json (p. ej. tras editarlo fuera
        de la app) y recategoriza lo cargado, sin reiniciar la app."""
        if any(isinstance(w, VentanaReglas) for w in self.winfo_children()):
            # Esa ventana trabaja sobre su propia copia de las reglas y, al
            # "Guardar y cerrar", sobrescribiría el archivo recién recargado.
            messagebox.showwarning(
                "Cierra el editor de reglas",
                "La ventana \"Reglas de categorización\" está abierta: ciérrala "
                "primero (si guardas ahí, reemplaza el archivo con su copia).",
            )
            return
        try:
            reglas = cargar_reglas()
        except (OSError, ValueError, KeyError, TypeError) as error:
            messagebox.showerror(
                "No se pudieron leer las reglas",
                f"reglas_categorizacion.json no se pudo leer; se siguen usando las "
                f"reglas anteriores.\n\n{error}",
            )
            return
        antes = len(self.reglas)
        self.reglas = reglas
        detalle = f"{len(reglas)} regla(s) cargada(s) (antes {antes})."
        if self.transacciones:
            anteriores = [(t.categoria, t.comercio) for t in self.transacciones]
            sin_categoria_antes = sum(1 for c, _ in anteriores if c is None)
            self.recategorizar()
            cambiadas = sum(
                1
                for previo, t in zip(anteriores, self.transacciones)
                if previo != (t.categoria, t.comercio)
            )
            sin_categoria = sum(1 for t in self.transacciones if t.categoria is None)
            detalle += (
                f"\n\nTransacciones recategorizadas: {cambiadas} cambiaron de "
                f"categoría/comercio. Sin categoría: {sin_categoria_antes} → {sin_categoria}."
            )
            if cambiadas:
                self.boton_guardar.config(state="normal")
                detalle += "\n\nGuarda el archivo procesado para conservar los cambios."
        messagebox.showinfo("Reglas recargadas", detalle)

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

    def _renglon_manual_seleccionado(self) -> TransaccionCanonica | None:
        """El renglón manual seleccionado en la tabla, o `None` (tras avisar)
        si no hay selección o lo seleccionado se extrajo del PDF."""
        seleccion = self.tabla.selection()
        if not seleccion:
            messagebox.showinfo(
                "Selecciona un renglón", "Selecciona en la tabla el renglón manual."
            )
            return None
        t = self.transacciones[int(seleccion[0])]
        if not t.linea_cruda.startswith(PREFIJO_RENGLON_MANUAL):
            messagebox.showinfo(
                "No es un renglón manual",
                "Solo los renglones agregados a mano (en amarillo) se pueden eliminar: "
                "los demás vienen del PDF. Para cambiar su categoría, haz doble clic "
                "en el renglón (o corrige la regla si aplica a varios).",
            )
            return None
        return t

    def editar_renglon_manual(self) -> None:
        t = self._renglon_manual_seleccionado()
        if t is not None:
            VentanaRenglonManual(self, editando=t)

    def editar_seleccion(self) -> None:
        """Doble clic / "Editar...": un renglón manual abre su formulario
        completo; uno o varios renglones del PDF, el cambio de categoría."""
        seleccion = self.tabla.selection()
        if not seleccion:
            return
        indices = [int(iid) for iid in seleccion]
        if len(indices) == 1 and self.transacciones[indices[0]].linea_cruda.startswith(
            PREFIJO_RENGLON_MANUAL
        ):
            VentanaRenglonManual(self, editando=self.transacciones[indices[0]])
        else:
            VentanaCategoriaManual(self, indices)

    def eliminar_renglon_manual(self) -> None:
        t = self._renglon_manual_seleccionado()
        if t is None:
            return
        if not messagebox.askyesno(
            "Eliminar renglón manual",
            f"¿Eliminar {t.fecha.isoformat()} · {t.descripcion} · {t.tipo} {t.monto:.2f}?\n\n"
            "Se quita de esta tabla y del archivo al volver a guardar. Si este "
            "documento ya estaba sincronizado, el renglón seguirá en Supabase "
            "(el sincronizador no borra filas): elimínalo a mano allá "
            "(Table Editor, tabla transacciones).",
        ):
            return
        self.transacciones = [x for x in self.transacciones if x is not t]
        self._refrescar_tabla()
        self._actualizar_totales()
        self.boton_guardar.config(state="normal")

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

        documento_hash = hash_pdf(self.ruta_pdf_actual)
        self.ruta_pdf_actual = mover_a_procesados_junto_al_pdf(self.ruta_pdf_actual)

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
                    # Puesta a mano (VentanaCategoriaManual): al recargar este
                    # PDF se recupera en vez de recalcularse con las reglas. El
                    # sincronizador no lee esta llave.
                    **({"categoria_manual": True} if self.tiene_categoria_manual(t) else {}),
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
        if self._ocupado:
            return
        if not messagebox.askyesno(
            "Sincronizar a Supabase",
            "Esto sube todos los archivos pendientes en data/procesados/ a tu "
            "proyecto de Supabase (autenticado como tú, vía .env). ¿Continuar?",
        ):
            return

        try:
            from dotenv import load_dotenv

            from sync.sincronizador import crear_cliente_autenticado, sincronizar_todos
        except ImportError as error:
            messagebox.showerror(
                "Faltan dependencias",
                f"No se pudo importar el Sincronizador: {error}\n\n"
                "Instala las dependencias de sincronización:\n"
                "pip install -r requirements.txt",
            )
            return

        load_dotenv()

        def trabajo(_progreso):
            # Iniciar sesión y subir son llamadas de red: en un hilo, para que
            # la ventana no se congele mientras tanto.
            try:
                client = crear_cliente_autenticado()
            except Exception as error:  # noqa: BLE001 — se distingue en _al_fallar_sincronizacion
                raise _ErrorDeSesion(error) from error
            return sincronizar_todos(client)

        resumen_anterior = self.etiqueta_resumen.cget("text")
        self._marcar_ocupado(True, "Sincronizando con Supabase…")
        correr_en_hilo(
            self,
            trabajo,
            lambda resultados: self._al_sincronizar(resultados, resumen_anterior),
            lambda error: self._al_fallar_sincronizacion(error, resumen_anterior),
        )

    def _al_fallar_sincronizacion(self, error: Exception, resumen_anterior: str) -> None:
        self._marcar_ocupado(False, resumen_anterior)
        causa = error.__cause__ if isinstance(error, _ErrorDeSesion) else error
        if isinstance(causa, KeyError):
            messagebox.showerror(
                "Falta configuración en .env",
                f"Falta la variable {causa} en tu archivo .env. Revisa "
                "SUPABASE_URL, SUPABASE_KEY, SUPABASE_EMAIL y SUPABASE_PASSWORD.",
            )
        elif isinstance(error, _ErrorDeSesion):  # típicamente login inválido
            messagebox.showerror(
                "No se pudo iniciar sesión en Supabase",
                f"{causa}\n\nRevisa SUPABASE_EMAIL/SUPABASE_PASSWORD en tu .env.",
            )
        else:
            messagebox.showerror("Error al sincronizar", str(error))

    def _al_sincronizar(self, resultados, resumen_anterior: str) -> None:
        from sync.sincronizador import NOMBRE_ARCHIVO_ESTADO_SYNC

        self._marcar_ocupado(False, resumen_anterior)
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


class _ErrorDeSesion(Exception):
    """No se pudo crear el cliente o iniciar sesión en Supabase (la causa
    queda en `__cause__`)."""


def main() -> None:
    App().mainloop()


if __name__ == "__main__":
    main()
