"""Sugerir reglas con Claude...": el flujo de la pestaña "Sin categorizar"
(pedir propuestas, y si hace falta instalar Claude Code o iniciar sesión) y la
ventana donde el usuario elige qué propuestas se vuelven reglas. La parte sin
interfaz vive en transform/sugerencias_ia.py (con pruebas)."""

from __future__ import annotations

import tkinter as tk
from tkinter import messagebox, ttk
from typing import TYPE_CHECKING

from app.hilos import correr_en_hilo
from transform import sugerencias_ia as ia
from transform.categorizador import Regla
from transform.sugerencias_ia import Sugerencia, problema_de

if TYPE_CHECKING:
    from app.main import App


def sugerir_reglas_con_ia(app: "App") -> None:
    """Pide a Claude las propuestas. Si Claude Code no está instalado o no
    tiene sesión, lo resuelve la app (ofrece instalarlo / abre el inicio de
    sesión) y luego reintenta sola: el usuario no corre comandos."""
    descripciones = list(app.descripciones_sin_categoria)
    if not descripciones or app._pidiendo_sugerencias:
        return

    reglas = list(app.reglas)
    texto_previo = app.etiqueta_sin_categorizar.cget("text")

    def ocupado(texto: str) -> None:
        app._pidiendo_sugerencias = True
        app.boton_sugerir_ia.config(state="disabled")
        app.etiqueta_sin_categorizar.config(text=texto)

    def libre(restaurar_texto: bool = True) -> None:
        app._pidiendo_sugerencias = False
        app._refrescar_sin_categorizar()
        if restaurar_texto:
            app.etiqueta_sin_categorizar.config(text=texto_previo)

    def mostrar_error(titulo: str, error: Exception) -> None:
        mensaje = str(error) if isinstance(error, ia.ErrorSugerenciasIA) else f"{type(error).__name__}: {error}"
        messagebox.showerror(titulo, mensaje)

    def pedir() -> None:
        ocupado(f"Claude está revisando {len(descripciones)} descripción(es)… (puede tardar un par de minutos)")
        correr_en_hilo(
            app,
            lambda _p: ia.pedir_sugerencias(descripciones, reglas),
            al_tener_propuestas,
            al_fallar_pedido,
        )

    def al_tener_propuestas(sugerencias) -> None:
        libre(restaurar_texto=False)
        VentanaSugerenciasIA(app, sugerencias)

    def al_fallar_pedido(error: Exception) -> None:
        libre()
        if isinstance(error, ia.FaltaClaudeCode):
            ofrecer_instalar()
        elif isinstance(error, ia.FaltaIniciarSesion):
            ofrecer_inicio_de_sesion()
        else:
            mostrar_error("No se pudieron obtener propuestas", error)

    def ofrecer_instalar() -> None:
        if not messagebox.askyesno(
            "Instalar Claude Code",
            "Para proponer reglas, la app usa Claude Code con tu suscripción de Claude "
            "(sin API key ni costo extra). No está instalado en esta computadora.\n\n"
            "¿Instalarlo ahora? Tarda uno o dos minutos y solo se hace una vez.",
        ):
            return
        ocupado("Instalando Claude Code… (uno o dos minutos)")
        correr_en_hilo(app, lambda _p: ia.instalar_claude(), al_instalar, al_fallar_instalacion)

    def al_instalar(_ruta) -> None:
        libre()
        ofrecer_inicio_de_sesion(recien_instalado=True)

    def al_fallar_instalacion(error: Exception) -> None:
        libre()
        mostrar_error("No se pudo instalar Claude Code", error)

    def ofrecer_inicio_de_sesion(recien_instalado: bool = False) -> None:
        intro = "Claude Code quedó instalado. " if recien_instalado else ""
        if not messagebox.askokcancel(
            "Iniciar sesión en Claude",
            f"{intro}Falta iniciar sesión con tu cuenta de Claude (solo la primera vez).\n\n"
            "Se abrirá una ventana negra y después el navegador: elige tu cuenta de "
            "Claude y autoriza. Cuando la ventana muestre la bienvenida, ciérrala y la "
            "app pedirá las propuestas sola.",
        ):
            return
        try:
            proceso = ia.abrir_inicio_de_sesion()
        except (ia.ErrorSugerenciasIA, OSError) as error:
            mostrar_error("No se pudo abrir el inicio de sesión", error)
            return
        ocupado("Esperando a que inicies sesión en la ventana de Claude… (ciérrala al terminar)")
        esperar_cierre(proceso)

    def esperar_cierre(proceso) -> None:
        if proceso.poll() is None:
            app.after(1000, lambda: esperar_cierre(proceso))
            return
        libre()
        pedir()

    pedir()


class VentanaSugerenciasIA(tk.Toplevel):
    """Propuestas de reglas hechas por Claude (`transform/sugerencias_ia.py`)
    para las descripciones sin categoría. Nada se guarda hasta "Agregar
    reglas": el usuario marca cuáles acepta y puede corregir patrón,
    categoría o comercio de cada una antes."""

    COLUMNAS = ("usar", "descripcion", "patron", "categoria", "comercio", "confianza", "nota")

    def __init__(self, master: "App", sugerencias: list[Sugerencia]) -> None:
        super().__init__(master)
        self.master_app = master
        self.sugerencias = sugerencias
        # Aceptadas de entrada: las que se pueden y que Claude no marcó "baja".
        self.marcadas = {
            i for i, s in enumerate(sugerencias) if s.aceptable and s.confianza.lower() != "baja"
        }
        self.title("Propuestas de Claude")
        self.transient(master)
        self.geometry("1150x560")
        self.minsize(800, 400)

        marco = ttk.Frame(self, padding=10)
        marco.pack(fill="both", expand=True)
        ttk.Label(
            marco,
            text=(
                "Marca (doble clic en ✓ o barra espaciadora) las propuestas que quieres "
                "convertir en reglas. Selecciona una fila para corregirla abajo. Las grises "
                "no se pueden agregar tal cual: corrígelas o déjalas para categorizar a mano."
            ),
            style="Ayuda.TLabel",
            wraplength=1100,
        ).pack(fill="x", pady=(0, 6))

        marco_tabla = ttk.Frame(marco)
        marco_tabla.pack(fill="both", expand=True)
        self.tabla = ttk.Treeview(marco_tabla, columns=self.COLUMNAS, show="headings", selectmode="browse")
        encabezados = {
            "usar": "✓", "descripcion": "Descripción", "patron": "Patrón", "categoria": "Categoría",
            "comercio": "Comercio", "confianza": "Confianza", "nota": "Nota de Claude",
        }
        anchos = {
            "usar": 30, "descripcion": 260, "patron": 150, "categoria": 130,
            "comercio": 150, "confianza": 70, "nota": 340,
        }
        for col in self.COLUMNAS:
            self.tabla.heading(col, text=encabezados[col])
            self.tabla.column(col, width=anchos[col], anchor="center" if col == "usar" else "w",
                              stretch=col in ("descripcion", "nota"))
        self.tabla.tag_configure("no_aceptable", foreground="#888")
        barra = ttk.Scrollbar(marco_tabla, orient="vertical", command=self.tabla.yview)
        self.tabla.configure(yscrollcommand=barra.set)
        self.tabla.pack(side="left", fill="both", expand=True)
        barra.pack(side="right", fill="y")
        self.tabla.bind("<<TreeviewSelect>>", lambda _e: self._cargar_edicion())
        self.tabla.bind("<Double-1>", self._doble_clic)
        self.tabla.bind("<space>", lambda _e: self._alternar_seleccionada())

        edicion = ttk.LabelFrame(marco, text="Corregir la fila seleccionada", padding=8)
        edicion.pack(fill="x", pady=(8, 0))
        categorias = sorted({r.categoria for r in master.reglas} | {s.categoria for s in sugerencias if s.categoria})
        comercios = sorted({r.comercio for r in master.reglas if r.comercio})
        ttk.Label(edicion, text="Patrón:").grid(row=0, column=0, sticky="w")
        self.entrada_patron = ttk.Entry(edicion, width=28)
        self.entrada_patron.grid(row=0, column=1, padx=(4, 12))
        ttk.Label(edicion, text="Categoría:").grid(row=0, column=2, sticky="w")
        self.combo_categoria = ttk.Combobox(edicion, values=categorias, width=24)
        self.combo_categoria.grid(row=0, column=3, padx=(4, 12))
        ttk.Label(edicion, text="Comercio:").grid(row=0, column=4, sticky="w")
        self.combo_comercio = ttk.Combobox(edicion, values=comercios, width=24)
        self.combo_comercio.grid(row=0, column=5, padx=(4, 12))
        ttk.Button(edicion, text="Aplicar a la fila", command=self._aplicar_edicion).grid(row=0, column=6)
        self.etiqueta_detalle = ttk.Label(edicion, text="", style="Ayuda.TLabel", wraplength=1080)
        self.etiqueta_detalle.grid(row=1, column=0, columnspan=7, sticky="w", pady=(6, 0))

        botones = ttk.Frame(marco)
        botones.pack(fill="x", pady=(10, 0))
        self.boton_agregar = ttk.Button(
            botones, text="", style="Primario.TButton", command=self._agregar
        )
        self.boton_agregar.pack(side="right")
        ttk.Button(botones, text="Cancelar", command=self.destroy).pack(side="right", padx=(0, 6))

        self.bind("<Escape>", lambda _e: self.destroy())
        self._refrescar()
        if sugerencias:
            self.tabla.selection_set("0")
            self.tabla.focus("0")
        self.grab_set()

    def _refrescar(self) -> None:
        seleccion = self.tabla.selection()
        self.tabla.delete(*self.tabla.get_children())
        for i, s in enumerate(self.sugerencias):
            nota = f"⚠ {s.problema}. {s.nota}" if s.problema else s.nota
            self.tabla.insert(
                "", "end", iid=str(i),
                values=(
                    "✓" if i in self.marcadas else "", s.descripcion, s.patron,
                    s.categoria or "—", s.comercio or "", s.confianza, nota,
                ),
                tags=() if s.aceptable else ("no_aceptable",),
            )
        if seleccion:
            self.tabla.selection_set(seleccion)
        self.boton_agregar.config(text=f"Agregar {len(self.marcadas)} regla(s)")
        self.boton_agregar.config(state="normal" if self.marcadas else "disabled")

    def _indice(self) -> int | None:
        seleccion = self.tabla.selection()
        return int(seleccion[0]) if seleccion else None

    def _doble_clic(self, evento) -> None:
        if self.tabla.identify_column(evento.x) == "#1":
            self._alternar_seleccionada()

    def _alternar_seleccionada(self) -> None:
        i = self._indice()
        if i is None:
            return
        if i in self.marcadas:
            self.marcadas.discard(i)
        elif self.sugerencias[i].aceptable:
            self.marcadas.add(i)
        else:
            self.bell()
        self._refrescar()

    def _cargar_edicion(self) -> None:
        i = self._indice()
        if i is None:
            return
        s = self.sugerencias[i]
        self.entrada_patron.delete(0, "end")
        self.entrada_patron.insert(0, s.patron)
        self.combo_categoria.set(s.categoria or "")
        self.combo_comercio.set(s.comercio or "")
        detalle = s.descripcion
        if s.nota or s.problema:
            detalle += "   ·   " + (f"⚠ {s.problema}. " if s.problema else "") + s.nota
        if s.tambien_aplica_a:
            detalle += "   ·   También atraparía: " + "; ".join(s.tambien_aplica_a[:5])
            if len(s.tambien_aplica_a) > 5:
                detalle += f" y {len(s.tambien_aplica_a) - 5} más"
        self.etiqueta_detalle.config(text=detalle)

    def _aplicar_edicion(self) -> None:
        i = self._indice()
        if i is None:
            return
        s = self.sugerencias[i]
        s.patron = self.entrada_patron.get().strip()
        s.categoria = self.combo_categoria.get().strip() or None
        s.comercio = self.combo_comercio.get().strip() or None
        otros = {o.patron.upper() for j, o in enumerate(self.sugerencias) if j != i and j in self.marcadas}
        s.problema = problema_de(s, {r.patron.upper() for r in self.master_app.reglas} | otros)
        s.tambien_aplica_a = tuple(
            o.descripcion for o in self.sugerencias
            if o is not s and s.patron and s.patron.upper() in o.descripcion.upper()
        )
        if s.aceptable:
            self.marcadas.add(i)
        else:
            self.marcadas.discard(i)
        self._refrescar()
        self._cargar_edicion()

    def _agregar(self) -> None:
        nuevas = [
            Regla(s.patron, s.categoria, s.comercio)
            for i, s in enumerate(self.sugerencias)
            if i in self.marcadas and s.aceptable
        ]
        if self.master_app.agregar_reglas(nuevas, parent=self):
            self.destroy()
