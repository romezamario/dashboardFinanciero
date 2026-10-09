"""Pestaña "Gastos recientes (Gmail)" de la app de escritorio: lee los avisos
de compra de Banamex en Gmail (sync/gmail_gastos.py) y los sube a Supabase.
Es la única tarea larga que la app corre sola al abrir (opcional); el trabajo
va en un hilo (app/hilos.py)."""

from __future__ import annotations

import json
import tkinter as tk
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from tkinter import messagebox, ttk

from app.hilos import correr_en_hilo

RAIZ = Path(__file__).parent.parent
# Gastos leídos de los avisos de compra en Gmail (sync/gmail_gastos.py) y las
# preferencias de esta pestaña; la carpeta está en .gitignore. Scripts que abran
# la app para probarla deben parchear estas dos (si no, la preferencia real de
# "revisar al abrir" dispara una revisión real de Gmail).
CARPETA_GASTOS_CORREO = RAIZ / "data" / "gastos_correo"
RUTA_PREFERENCIAS_GMAIL = CARPETA_GASTOS_CORREO / "preferencias.json"
# Tope del cuadro "Días hacia atrás" (10 años); todo el historial: `python -m sync.gmail_gastos --todo --subir`.
MAXIMO_DIAS_GMAIL = 3650

def _leer_preferencias_gmail() -> dict:
    try:
        datos = json.loads(RUTA_PREFERENCIAS_GMAIL.read_text(encoding="utf-8"))
        return datos if isinstance(datos, dict) else {}
    except (OSError, ValueError):
        return {}


def _guardar_preferencias_gmail(preferencias: dict) -> None:
    RUTA_PREFERENCIAS_GMAIL.parent.mkdir(parents=True, exist_ok=True)
    RUTA_PREFERENCIAS_GMAIL.write_text(
        json.dumps(preferencias, ensure_ascii=False, indent=2), encoding="utf-8"
    )


class PestanaGastosGmail(ttk.Frame):
    """Pestaña "Gastos recientes (Gmail)": lee los avisos de compra de Banamex
    en Gmail, los guarda en data/gastos_correo/ y los sube a Supabase -- lo mismo
    que `python -m sync.gmail_gastos --dias N --subir` (ver `revisar_gmail`).

    Es la única operación de la app que corre en un hilo aparte: leer Gmail
    tarda (un correo a la vez) y la primera autorización espera al navegador.
    El hilo nunca toca widgets: manda mensajes a una cola que la interfaz
    revisa con `after()` (Tkinter no es seguro entre hilos)."""

    COLUMNAS = ("fecha", "hora", "tarjeta", "comercio", "ciudad", "categoria", "monto")
    MAXIMO_EN_TABLA = 200

    def __init__(self, master: tk.Misc) -> None:
        super().__init__(master)
        self._trabajando = False
        preferencias = _leer_preferencias_gmail()

        marco_acciones = ttk.Frame(self)
        marco_acciones.pack(fill="x", padx=8, pady=(8, 4))
        ttk.Label(marco_acciones, text="Días hacia atrás:").pack(side="left")
        self.spin_dias = ttk.Spinbox(marco_acciones, from_=1, to=MAXIMO_DIAS_GMAIL, width=5)
        self.spin_dias.set(str(preferencias.get("dias", 3)))
        self.spin_dias.pack(side="left", padx=4)
        self.boton_revisar = ttk.Button(
            marco_acciones, text="Revisar Gmail y subir", command=self.revisar
        )
        self.boton_revisar.pack(side="left", padx=(8, 0))
        self.boton_reautorizar = ttk.Button(
            marco_acciones, text="Reautorizar Gmail...", command=self.reautorizar
        )
        self.boton_reautorizar.pack(side="left", padx=4)
        self.var_al_abrir = tk.BooleanVar(value=bool(preferencias.get("revisar_al_abrir", False)))
        ttk.Checkbutton(
            marco_acciones,
            text="Revisar automáticamente al abrir la app",
            variable=self.var_al_abrir,
            command=self._guardar_preferencias,
        ).pack(side="right")

        marco_estado = ttk.Frame(self)
        marco_estado.pack(fill="x", padx=8)
        self.barra = ttk.Progressbar(marco_estado, mode="determinate", length=160)
        self.barra.pack(side="left")
        self.etiqueta_estado = ttk.Label(marco_estado, text="Sin revisar en esta sesión.")
        self.etiqueta_estado.pack(side="left", padx=8)

        marco_avisos = ttk.Frame(self)
        marco_avisos.pack(fill="x", padx=8, pady=4)
        self.texto_avisos = tk.Text(marco_avisos, height=4, wrap="word", state="disabled")
        self.texto_avisos.pack(side="left", fill="x", expand=True)
        ttk.Button(marco_avisos, text="Copiar avisos", command=self._copiar_avisos).pack(
            side="left", padx=(4, 0), anchor="n"
        )

        marco_tabla = ttk.Frame(self)
        marco_tabla.pack(fill="both", expand=True, padx=8, pady=(0, 4))
        self.tabla = ttk.Treeview(marco_tabla, columns=self.COLUMNAS, show="headings")
        encabezados = {
            "fecha": "Fecha", "hora": "Hora", "tarjeta": "Tarjeta", "comercio": "Comercio",
            "ciudad": "Ciudad", "categoria": "Categoría", "monto": "Monto",
        }
        anchos = {
            "fecha": 85, "hora": 50, "tarjeta": 60, "comercio": 200,
            "ciudad": 150, "categoria": 140, "monto": 90,
        }
        for col in self.COLUMNAS:
            self.tabla.heading(col, text=encabezados[col])
            self.tabla.column(col, width=anchos[col], anchor="e" if col == "monto" else "w")
        self.tabla.tag_configure("sin_categoria", background="#fff4cc")
        barra_tabla = ttk.Scrollbar(marco_tabla, orient="vertical", command=self.tabla.yview)
        self.tabla.configure(yscrollcommand=barra_tabla.set)
        self.tabla.pack(side="left", fill="both", expand=True)
        barra_tabla.pack(side="right", fill="y")

        self.etiqueta_tabla = ttk.Label(self, text="", foreground="#666")
        self.etiqueta_tabla.pack(fill="x", padx=8, pady=(0, 6))

        self.refrescar_tabla()

    # -- Tabla y avisos ------------------------------------------------------

    def refrescar_tabla(self) -> None:
        from sync.gmail_gastos import cargar_gastos_recientes

        gastos, ilegibles = cargar_gastos_recientes(CARPETA_GASTOS_CORREO, self.MAXIMO_EN_TABLA)
        self.tabla.delete(*self.tabla.get_children())
        for g in gastos:
            ciudad = g.get("ciudad") or (
                f"{g['ciudad_cod']} (sin confirmar)" if g.get("ciudad_cod") else ""
            )
            try:
                monto = f"{Decimal(str(g.get('monto'))):,.2f}"
            except InvalidOperation:
                monto = str(g.get("monto", ""))
            categoria = g.get("categoria") or "Sin categoría"
            self.tabla.insert(
                "",
                "end",
                values=(
                    g["fecha"], g.get("hora", ""), g.get("tarjeta", ""), g.get("comercio", ""),
                    ciudad, categoria, monto,
                ),
                tags=("sin_categoria",) if categoria == "Sin categoría" else (),
            )
        texto = (
            f"Los {len(gastos)} gasto(s) más recientes de data/gastos_correo/ "
            f"(máximo {self.MAXIMO_EN_TABLA}); en amarillo, sin categoría."
            if gastos
            else "Todavía no hay gastos leídos de Gmail en data/gastos_correo/."
        )
        if ilegibles:
            texto += f" No se pudieron leer: {', '.join(ilegibles)}."
        self.etiqueta_tabla.config(text=texto)

    def _mostrar_avisos(self, lineas: list[str]) -> None:
        self.texto_avisos.config(state="normal")
        self.texto_avisos.delete("1.0", "end")
        self.texto_avisos.insert("1.0", "\n".join(lineas) if lineas else "Sin avisos.")
        self.texto_avisos.config(state="disabled")

    def _copiar_avisos(self) -> None:
        self.clipboard_clear()
        self.clipboard_append(self.texto_avisos.get("1.0", "end-1c"))

    def _guardar_preferencias(self) -> None:
        preferencias = _leer_preferencias_gmail()
        preferencias["revisar_al_abrir"] = bool(self.var_al_abrir.get())
        try:
            preferencias["dias"] = int(self.spin_dias.get())
        except ValueError:
            pass
        try:
            _guardar_preferencias_gmail(preferencias)
        except OSError as error:
            messagebox.showwarning("No se pudo guardar la preferencia", str(error))

    # -- Hilo de trabajo -----------------------------------------------------

    def _en_hilo(self, trabajo, al_terminar, al_fallar) -> None:
        """Corre `trabajo(progreso)` en un hilo (ver app/hilos.py);
        `al_terminar(resultado)` o `al_fallar(error)` corren después en el
        hilo de la interfaz, con los botones ya rehabilitados."""
        self._trabajando = True
        for widget in (self.boton_revisar, self.boton_reautorizar, self.spin_dias):
            widget.config(state="disabled")
        self.barra.config(mode="indeterminate")
        self.barra.start(12)

        def terminar(resultado) -> None:
            self._terminar_trabajo()
            al_terminar(resultado)

        def fallar(error: Exception) -> None:
            self._terminar_trabajo()
            al_fallar(error)

        correr_en_hilo(self, trabajo, terminar, fallar, self._mostrar_progreso)

    def _mostrar_progreso(self, texto: str, hechos: int | None = None, total: int | None = None) -> None:
        self.etiqueta_estado.config(text=texto, foreground="")
        if total:
            if str(self.barra.cget("mode")) != "determinate":
                self.barra.stop()
                self.barra.config(mode="determinate")
            self.barra.config(maximum=total, value=hechos or 0)

    def _terminar_trabajo(self) -> None:
        self._trabajando = False
        self.barra.stop()
        self.barra.config(mode="determinate", value=0)
        for widget in (self.boton_revisar, self.boton_reautorizar):
            widget.config(state="normal")
        self.spin_dias.config(state="normal")

    # -- Acciones ------------------------------------------------------------

    def revisar(self, automatico: bool = False) -> None:
        """Revisa Gmail y sube. `automatico` (al abrir la app): sin ventanas
        emergentes y sin abrir el navegador para autorizar -- los problemas
        quedan escritos en la pestaña."""
        if self._trabajando:
            return
        try:
            dias = int(self.spin_dias.get())
            if not 1 <= dias <= MAXIMO_DIAS_GMAIL:
                raise ValueError
        except ValueError:
            messagebox.showwarning(
                "Días inválidos", f"Escribe un número de días entre 1 y {MAXIMO_DIAS_GMAIL}."
            )
            return
        self._guardar_preferencias()
        self._iniciar_revision(dias, automatico)

    def _iniciar_revision(self, dias: int, automatico: bool) -> None:
        self.etiqueta_estado.config(text="Iniciando…", foreground="")

        def trabajo(progreso):
            from dotenv import load_dotenv

            from sync.gmail_gastos import revisar_gmail

            load_dotenv()
            return revisar_gmail(
                dias, subir=True, permitir_autorizar=not automatico, progreso=progreso
            )

        self._en_hilo(
            trabajo,
            lambda resultado: self._al_terminar_revision(resultado, automatico),
            lambda error: self._al_fallar_revision(error, automatico),
        )

    def _al_terminar_revision(self, r, automatico: bool) -> None:
        from sync.gmail_gastos import avisos_para_mostrar, resumen_revision

        avisos = avisos_para_mostrar(r)
        resumen = resumen_revision(r)
        hora = datetime.now().strftime("%H:%M")
        self.etiqueta_estado.config(
            text=f"{hora} · {resumen}", foreground="#a60" if r.subidas_fallidas else "green"
        )
        self._mostrar_avisos(avisos)
        self.refrescar_tabla()
        if automatico:
            return
        detalle = resumen
        if avisos:
            detalle += "\n\nRevisa los avisos en la pestaña (\"Copiar avisos\" los copia)."
        if r.subidas_fallidas:
            messagebox.showwarning("Gastos de Gmail: hubo errores al subir", detalle)
        else:
            messagebox.showinfo("Gastos de Gmail", detalle)

    def _al_fallar_revision(self, error: Exception, automatico: bool) -> None:
        try:
            from sync.gmail_gastos import ErrorGastosGmail, PermisoGmailInvalido
        except ImportError:  # p. ej. falta python-dotenv
            ErrorGastosGmail = PermisoGmailInvalido = ()  # type: ignore[assignment]

        if isinstance(error, ImportError):
            mensaje = (
                f"Falta una librería ({error.name}). Instala las dependencias con:\n"
                "pip install -r requirements.txt"
            )
        elif isinstance(error, ErrorGastosGmail):
            mensaje = str(error)
        else:
            mensaje = (
                f"No se pudo completar la revisión ({type(error).__name__}): {error}\n\n"
                "Revisa tu conexión a internet y vuelve a intentarlo."
            )
        self.etiqueta_estado.config(text=mensaje.splitlines()[0], foreground="red")
        self._mostrar_avisos([mensaje])

        if isinstance(error, PermisoGmailInvalido):
            if automatico:
                self.etiqueta_estado.config(
                    text="El permiso de Gmail venció o falta: usa \"Reautorizar Gmail...\".",
                    foreground="red",
                )
                return
            if messagebox.askyesno(
                "Permiso de Gmail",
                f"{mensaje}\n\n¿Reautorizar ahora? Se abrirá el navegador para que "
                "aceptes el acceso de solo lectura; después se repite la revisión.",
            ):
                self.reautorizar(preguntar=False, luego_revisar=True)
            return
        if not automatico:
            messagebox.showerror("Gastos de Gmail", mensaje)

    def reautorizar(self, preguntar: bool = True, luego_revisar: bool = False) -> None:
        if self._trabajando:
            return
        if preguntar and not messagebox.askyesno(
            "Reautorizar Gmail",
            "Se abrirá el navegador para volver a autorizar el acceso de SOLO LECTURA "
            "a tu Gmail. El permiso nuevo reemplaza al guardado. ¿Continuar?",
        ):
            return

        def trabajo(progreso):
            from dotenv import load_dotenv

            from sync.gmail_gastos import crear_servicio_gmail

            load_dotenv()
            progreso("Esperando la autorización en el navegador…")
            crear_servicio_gmail(forzar_autorizacion=True)
            return None

        def al_terminar(_resultado) -> None:
            self.etiqueta_estado.config(text="Gmail autorizado.", foreground="green")
            if luego_revisar:
                self.revisar()
            else:
                messagebox.showinfo("Reautorizar Gmail", "Listo: Gmail quedó autorizado.")

        self._en_hilo(
            trabajo, al_terminar, lambda error: self._al_fallar_revision(error, automatico=False)
        )

    def revisar_al_abrir(self) -> None:
        """Si el usuario lo activó: revisión automática, solo si ya hay un
        permiso guardado (nunca abre el navegador sin que lo pida)."""
        if not self.var_al_abrir.get():
            return
        try:
            from dotenv import load_dotenv

            from sync.gmail_gastos import hay_permiso_guardado

            load_dotenv()
        except ImportError as error:
            self.etiqueta_estado.config(
                text=f"Revisión automática: falta la librería {error.name}.", foreground="red"
            )
            return
        if not hay_permiso_guardado():
            self.etiqueta_estado.config(
                text="Revisión automática omitida: autoriza Gmail primero con \"Revisar Gmail y subir\".",
                foreground="#a60",
            )
            return
        self.revisar(automatico=True)
