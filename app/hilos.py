"""Trabajo largo fuera del hilo de la interfaz.

Tkinter no es seguro entre hilos: el trabajo corre en un hilo aparte y NUNCA
toca widgets; avisa por una `queue.Queue` que la interfaz vacía con
`after()`, y `al_terminar` / `al_fallar` / `al_progresar` corren en el hilo
de la interfaz. Lo usan la pestaña de Gmail, la carga de un PDF y la
sincronización con Supabase (antes estas dos congelaban la ventana).
"""

from __future__ import annotations

import queue
import threading
import tkinter as tk
from collections.abc import Callable
from typing import Any

# (mensaje, hechos, total): `hechos`/`total` opcionales, para una barra.
Progreso = Callable[..., None]

INTERVALO_MS = 100


def correr_en_hilo(
    raiz: tk.Misc,
    trabajo: Callable[[Progreso], Any],
    al_terminar: Callable[[Any], None],
    al_fallar: Callable[[Exception], None],
    al_progresar: Callable[..., None] | None = None,
) -> None:
    """Corre `trabajo(progreso)` en un hilo. `progreso(...)` se puede llamar
    desde el hilo; sus argumentos llegan a `al_progresar` en la interfaz.
    Al final se llama `al_terminar(resultado)` o `al_fallar(error)`."""
    cola: queue.Queue = queue.Queue()

    def progreso(*args: Any) -> None:
        cola.put(("progreso", args))

    def correr() -> None:
        try:
            cola.put(("fin", trabajo(progreso)))
        except Exception as error:  # noqa: BLE001 -- se entrega a al_fallar
            cola.put(("error", error))

    def revisar() -> None:
        try:
            while True:
                tipo, dato = cola.get_nowait()
                if tipo == "progreso":
                    if al_progresar is not None:
                        al_progresar(*dato)
                    continue
                (al_terminar if tipo == "fin" else al_fallar)(dato)
                return
        except queue.Empty:
            pass
        try:
            raiz.after(INTERVALO_MS, revisar)
        except tk.TclError:
            pass  # la ventana ya se cerró

    threading.Thread(target=correr, daemon=True).start()
    revisar()
