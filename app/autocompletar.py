"""Sugerencias mientras se escribe en un combo de categoría o comercio.

Un `ttk.Combobox` editable solo muestra su lista completa con la flecha; para
encontrar "Restaurantes" había que recorrerla entera. `activar_autocompletado`
abre, debajo del combo, una lista con las opciones que contienen lo escrito
(sin importar mayúsculas ni acentos, `filtrar_opciones`), sin quitarle el foco
al combo: se sigue escribiendo, ↑/↓ recorren la lista, Enter o Tab eligen,
Esc la cierra (sin cerrar el diálogo) y un clic elige. Al elegir se dispara
`<<ComboboxSelected>>`, igual que con la flecha, así que los diálogos que ya
escuchan ese evento no cambian. Las opciones se leen de `values` del combo en
cada tecla, así que un `configure(values=...)` posterior se respeta.
"""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from app.logica import filtrar_opciones

MAXIMO_SUGERENCIAS = 10
TECLAS_IGNORADAS = {
    "Up", "Down", "Return", "KP_Enter", "Escape", "Tab", "ISO_Left_Tab",
    "Shift_L", "Shift_R", "Control_L", "Control_R", "Alt_L", "Alt_R",
    "Left", "Right", "Home", "End", "Caps_Lock",
}


class Autocompletado:
    def __init__(self, combo: ttk.Combobox) -> None:
        self.combo = combo
        self.popup: tk.Toplevel | None = None
        self.lista: tk.Listbox | None = None
        self.opciones: list[str] = []
        combo.bind("<KeyRelease>", self._al_soltar_tecla, add="+")
        combo.bind("<Down>", lambda _e: self._mover(1), add="+")
        combo.bind("<Up>", lambda _e: self._mover(-1), add="+")
        combo.bind("<Return>", self._elegir_resaltada, add="+")
        combo.bind("<KP_Enter>", self._elegir_resaltada, add="+")
        combo.bind("<Tab>", self._elegir_con_tab, add="+")
        combo.bind("<Escape>", self._escape, add="+")
        combo.bind("<FocusOut>", lambda _e: combo.after(200, self._cerrar_si_sin_foco), add="+")
        combo.bind("<<ComboboxSelected>>", lambda _e: self.cerrar(), add="+")
        combo.bind("<Destroy>", lambda _e: self.cerrar(), add="+")
        ventana = combo.winfo_toplevel()
        # Mover o redimensionar el diálogo deja la lista flotando fuera de lugar.
        ventana.bind(
            "<Configure>", lambda e: self.cerrar() if e.widget is ventana else None, add="+"
        )

    # --- teclado -----------------------------------------------------------

    def _al_soltar_tecla(self, evento: tk.Event) -> None:
        if evento.keysym in TECLAS_IGNORADAS:
            return
        opciones = filtrar_opciones(
            list(self.combo.cget("values") or ()), self.combo.get(), MAXIMO_SUGERENCIAS
        )
        # Si lo único que coincide es exactamente lo escrito, no hay nada que sugerir.
        if not opciones or (len(opciones) == 1 and opciones[0] == self.combo.get()):
            self.cerrar()
            return
        self._mostrar(opciones)

    def _mover(self, paso: int) -> str | None:
        if self.lista is None:
            return None  # sin lista abierta, ↓ abre la del combo como siempre
        actual = self.lista.curselection()
        indice = (actual[0] + paso) if actual else (0 if paso > 0 else len(self.opciones) - 1)
        indice = max(0, min(len(self.opciones) - 1, indice))
        self._resaltar(indice)
        return "break"

    def _elegir_resaltada(self, _evento=None) -> str | None:
        if self.lista is None:
            return None  # sin lista, Enter hace lo de siempre (p. ej. Guardar)
        actual = self.lista.curselection()
        if not actual:
            self.cerrar()
            return None
        self._elegir(self.opciones[actual[0]])
        return "break"

    def _elegir_con_tab(self, _evento=None) -> None:
        if self.lista is not None and self.lista.curselection():
            self._elegir(self.opciones[self.lista.curselection()[0]])
        self.cerrar()  # Tab sigue al siguiente campo

    def _escape(self, _evento=None) -> str | None:
        if self.popup is None:
            return None
        self.cerrar()
        return "break"  # no cierra el diálogo, solo la lista

    # --- lista -------------------------------------------------------------

    def _mostrar(self, opciones: list[str]) -> None:
        self.opciones = opciones
        if self.popup is None:
            self.popup = tk.Toplevel(self.combo)
            self.popup.overrideredirect(True)
            self.popup.attributes("-topmost", True)
            self.lista = tk.Listbox(
                self.popup, activestyle="none", exportselection=False, takefocus=0,
                borderwidth=1, relief="solid", highlightthickness=0,
            )
            self.lista.pack(fill="both", expand=True)
            self.lista.bind("<ButtonRelease-1>", self._clic)
            self.lista.bind("<Motion>", self._al_mover_raton)
        assert self.lista is not None
        self.lista.delete(0, "end")
        for opcion in opciones:
            self.lista.insert("end", opcion)
        self.lista.configure(height=len(opciones))
        self.combo.update_idletasks()
        x = self.combo.winfo_rootx()
        y = self.combo.winfo_rooty() + self.combo.winfo_height()
        self.popup.geometry(f"{self.combo.winfo_width()}x{self.lista.winfo_reqheight()}+{x}+{y}")
        self.popup.deiconify()
        self.popup.lift()

    def _resaltar(self, indice: int) -> None:
        assert self.lista is not None
        self.lista.selection_clear(0, "end")
        self.lista.selection_set(indice)
        self.lista.see(indice)

    def _al_mover_raton(self, evento: tk.Event) -> None:
        assert self.lista is not None
        self._resaltar(self.lista.nearest(evento.y))

    def _clic(self, evento: tk.Event) -> None:
        assert self.lista is not None
        indice = self.lista.nearest(evento.y)
        if 0 <= indice < len(self.opciones):
            self._elegir(self.opciones[indice])

    def _elegir(self, opcion: str) -> None:
        self.cerrar()
        self.combo.set(opcion)
        self.combo.icursor("end")
        self.combo.focus_set()
        self.combo.event_generate("<<ComboboxSelected>>")

    def _cerrar_si_sin_foco(self) -> None:
        try:
            if self.combo.focus_get() not in (self.combo, self.lista):
                self.cerrar()
        except (KeyError, tk.TclError):  # el foco está en un widget ya destruido
            self.cerrar()

    def cerrar(self) -> None:
        if self.popup is not None:
            try:
                self.popup.destroy()
            except tk.TclError:
                pass
        self.popup = None
        self.lista = None
        self.opciones = []


def activar_autocompletado(*combos: ttk.Combobox) -> list[Autocompletado]:
    """Activa las sugerencias en cada combo; devuelve los objetos para que
    vivan tanto como el diálogo (guárdalos en un atributo)."""
    return [Autocompletado(c) for c in combos]
