"""Diálogos de la app de escritorio: reglas de categorización, inspección
anonimizada de un PDF, renglón manual, categoría manual y propuestas de Claude. Separados de
`app/main.py` (que se había vuelto un solo archivo de más de 2,000 líneas);
cada uno recibe la ventana principal (`App`) como `master`."""

from __future__ import annotations

import tkinter as tk
from dataclasses import replace
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import TYPE_CHECKING

import pdfplumber

from app.logica import PREFIJO_RENGLON_MANUAL
from parsers._anonimizador import anonimizar
from transform.categorizador import Regla, guardar_reglas, inferir_categoria_comercio
from transform.transformador import TransaccionCanonica

if TYPE_CHECKING:
    from app.main import App

class VentanaReglas(tk.Toplevel):
    """Editor de reglas de categorización — se abre sobre la ventana principal."""

    def __init__(self, master: "App") -> None:
        super().__init__(master)
        self.title("Reglas de categorización")
        self.geometry("560x440")
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
        # La primera regla que coincide gana, así que el orden importa (p. ej.
        # "SU PAGO INTERBANCARIO" debe ir antes que "PAGO INTERBANCARIO"); una
        # regla nueva se agrega al final, y sin esto la única forma de
        # adelantarla era editar el JSON a mano.
        ttk.Button(marco_botones, text="▲ Subir", command=lambda: self._mover(-1)).pack(
            side="left"
        )
        ttk.Button(marco_botones, text="▼ Bajar", command=lambda: self._mover(1)).pack(
            side="left", padx=4
        )
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

    def _mover(self, direccion: int) -> None:
        seleccion = self.tabla.selection()
        if not seleccion:
            return
        indice = self.tabla.index(seleccion[0])
        destino = indice + direccion
        if not 0 <= destino < len(self.reglas):
            return
        self.reglas[indice], self.reglas[destino] = self.reglas[destino], self.reglas[indice]
        self._refrescar_tabla()
        hijo = self.tabla.get_children()[destino]
        self.tabla.selection_set(hijo)
        self.tabla.see(hijo)

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

    Con `editando` (un renglón manual ya agregado) el mismo formulario sirve
    para corregirlo: llega precargado y "Guardar cambios" lo reemplaza en su
    lugar en vez de agregar uno nuevo.
    """

    OPCIONES_TARJETA = ("Titular", "Adicional", "Digital")

    def __init__(
        self, master: "App", editando: TransaccionCanonica | None = None
    ) -> None:
        super().__init__(master)
        self.editando = editando
        self.title("Editar renglón manual" if editando else "Agregar renglón manual")
        self.geometry("430x400")
        self.master_app = master
        # Copia: al agregar un renglón se consume su sugerencia sin tocar la
        # lista de la App (que sigue reflejando lo que detectó la carga).
        self.sugerencias = [] if editando else list(master.sugerencias_renglon_manual)
        # Mientras el usuario no toque categoría/comercio a mano, se siguen
        # re-infiriendo al cambiar la descripción; en cuanto los edita, se
        # respeta lo que puso. Al editar se respeta desde el inicio lo que ya
        # tenía el renglón.
        self._categoria_editada = editando is not None
        self._comercio_editado = editando is not None

        marco = ttk.Frame(self)
        marco.pack(fill="both", expand=True, padx=8, pady=8)

        ttk.Label(marco, text="Fecha (AAAA-MM-DD):").grid(row=0, column=0, sticky="w", pady=2)
        # Combo editable: las fechas donde el extractor detectó una línea
        # faltante van como opciones; sigue pudiendo teclearse cualquier otra.
        self.combo_fecha = ttk.Combobox(marco, values=self._fechas_sugeridas())
        self.combo_fecha.grid(row=0, column=1, sticky="ew", padx=4)
        self.combo_fecha.bind("<<ComboboxSelected>>", lambda _e: self._aplicar_sugerencia())

        ttk.Label(marco, text="Descripción:").grid(row=1, column=0, sticky="w", pady=2)
        self.entrada_descripcion = ttk.Entry(marco)
        self.entrada_descripcion.grid(row=1, column=1, sticky="ew", padx=4)
        self.entrada_descripcion.bind("<KeyRelease>", lambda _e: self._inferir_categoria())

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

        ttk.Label(marco, text="Tarjeta (opcional):").grid(row=5, column=0, sticky="w", pady=2)
        # Combo editable: Titular/Adicional/Digital son lo que imprimen las
        # TDC de Banamex; un documento de Invex V2 sin rol conocido usa los
        # últimos 4 dígitos como `tarjeta`, así que se suman los valores que
        # ya traen las transacciones cargadas (y la sugerencia) y se deja
        # teclear otro.
        self.combo_tarjeta = ttk.Combobox(marco, values=self._opciones_tarjeta())
        self.combo_tarjeta.grid(row=5, column=1, sticky="ew", padx=4)

        ttk.Label(marco, text="Categoría:").grid(row=6, column=0, sticky="w", pady=2)
        self.combo_categoria = ttk.Combobox(marco, values=self._opciones_categoria())
        self.combo_categoria.grid(row=6, column=1, sticky="ew", padx=4)
        self.combo_categoria.bind("<KeyRelease>", lambda _e: self._marcar_categoria_editada())
        self.combo_categoria.bind(
            "<<ComboboxSelected>>", lambda _e: self._marcar_categoria_editada()
        )

        ttk.Label(marco, text="Comercio (opcional):").grid(row=7, column=0, sticky="w", pady=2)
        self.combo_comercio = ttk.Combobox(marco, values=self._opciones_comercio())
        self.combo_comercio.grid(row=7, column=1, sticky="ew", padx=4)
        self.combo_comercio.bind("<KeyRelease>", lambda _e: self._marcar_comercio_editado())
        self.combo_comercio.bind(
            "<<ComboboxSelected>>", lambda _e: self._marcar_comercio_editado()
        )

        marco.columnconfigure(1, weight=1)

        ttk.Label(
            marco,
            text=(
                "Categoría y comercio se infieren al escribir la descripción (primero "
                "las reglas actuales, luego transacciones ya cargadas parecidas); "
                "puedes cambiarlos. Si los dejas vacíos, el renglón queda sin categoría."
            ),
            foreground="#666",
            wraplength=390,
        ).grid(row=8, column=0, columnspan=2, sticky="w", pady=(8, 0))

        if editando is None:
            self._aplicar_sugerencia(primera=True)
        else:
            self._precargar(editando)

        marco_botones = ttk.Frame(self)
        marco_botones.pack(fill="x", padx=8, pady=8)
        ttk.Button(
            marco_botones,
            text="Guardar cambios" if editando else "Agregar",
            command=self._guardar_edicion if editando else self._agregar,
        ).pack(side="left")
        ttk.Button(marco_botones, text="Cerrar", command=self.destroy).pack(
            side="right"
        )

    SIN_TARJETA = "(sin tarjeta)"

    def _fechas_sugeridas(self) -> list[str]:
        # dict.fromkeys: únicas, en el orden en que el extractor las encontró.
        return list(dict.fromkeys(fecha for fecha, _pagina, _tarjeta in self.sugerencias))

    def _opciones_tarjeta(self) -> list[str]:
        cargadas = (t.tarjeta for t in self.master_app.transacciones)
        sugeridas = (tarjeta for _fecha, _pagina, tarjeta in self.sugerencias)
        extras = [t for t in (*cargadas, *sugeridas) if t]
        return list(dict.fromkeys([self.SIN_TARJETA, *self.OPCIONES_TARJETA, *extras]))

    def _opciones_categoria(self) -> list[str]:
        nombres = {t.categoria for t in self.master_app.transacciones if t.categoria}
        nombres |= {r.categoria for r in self.master_app.reglas}
        return sorted(nombres)

    def _opciones_comercio(self) -> list[str]:
        nombres = {t.comercio for t in self.master_app.transacciones if t.comercio}
        nombres |= {r.comercio for r in self.master_app.reglas if r.comercio}
        return sorted(nombres)

    def _aplicar_sugerencia(self, primera: bool = False) -> None:
        """Precarga página y tarjeta de la línea detectada en la fecha
        elegida. Con `primera=True` (al abrir) también elige la primera fecha
        detectada, o la de hoy si el extractor no detectó nada."""
        if primera:
            self.combo_fecha.set(
                self.sugerencias[0][0] if self.sugerencias else date.today().isoformat()
            )
        fecha = self.combo_fecha.get().strip()
        sugerencia = next((s for s in self.sugerencias if s[0] == fecha), None)
        if sugerencia is None:
            return
        _fecha, pagina, tarjeta = sugerencia
        self.entrada_pagina.delete(0, "end")
        if pagina is not None:
            self.entrada_pagina.insert(0, str(pagina))
        self.combo_tarjeta.set(tarjeta or self.SIN_TARJETA)

    def _inferir_categoria(self) -> None:
        descripcion = self.entrada_descripcion.get()
        parser = self.master_app.parser_actual
        if parser is not None:
            descripcion = parser.descripcion_para_categorizar(descripcion)
        categoria, comercio = inferir_categoria_comercio(
            descripcion,
            self.master_app.reglas,
            self.master_app.transacciones,
        )
        if not self._categoria_editada:
            self._categoria_inferida = categoria or ""
            self.combo_categoria.set(self._categoria_inferida)
        if not self._comercio_editado:
            self._comercio_inferido = comercio or ""
            self.combo_comercio.set(self._comercio_inferido)

    # Se compara contra lo último que escribió la inferencia (y no se marca
    # "editado" a ciegas en cada KeyRelease) porque soltar la tecla Tab al
    # pasar de Descripción a estos combos también dispara KeyRelease ahí.
    _categoria_inferida = ""
    _comercio_inferido = ""

    def _marcar_categoria_editada(self) -> None:
        if self.combo_categoria.get() != self._categoria_inferida:
            self._categoria_editada = True

    def _marcar_comercio_editado(self) -> None:
        if self.combo_comercio.get() != self._comercio_inferido:
            self._comercio_editado = True

    def _precargar(self, t: TransaccionCanonica) -> None:
        self.combo_fecha.set(t.fecha.isoformat())
        self.entrada_descripcion.insert(0, t.descripcion)
        self.entrada_monto.insert(0, f"{t.monto:.2f}")
        self.combo_tipo.set(t.tipo)
        self.entrada_pagina.insert(0, str(t.pagina))
        self.combo_tarjeta.set(t.tarjeta or self.SIN_TARJETA)
        self.combo_categoria.set(t.categoria or "")
        self.combo_comercio.set(t.comercio or "")

    def _leer_formulario(self) -> dict | None:
        """Valida el formulario y devuelve sus valores ya convertidos, o
        `None` (tras avisar al usuario) si algo no es válido."""
        # Por si la descripción se pegó con el mouse (no dispara KeyRelease).
        self._inferir_categoria()

        fecha_texto = self.combo_fecha.get().strip()
        descripcion = self.entrada_descripcion.get().strip()
        monto_texto = self.entrada_monto.get().strip().replace(",", "")
        tipo = self.combo_tipo.get()
        pagina_texto = self.entrada_pagina.get().strip()
        tarjeta_texto = self.combo_tarjeta.get().strip()
        tarjeta = None if tarjeta_texto in ("", self.SIN_TARJETA) else tarjeta_texto
        categoria = self.combo_categoria.get().strip() or None
        comercio = self.combo_comercio.get().strip() or None

        try:
            fecha = date.fromisoformat(fecha_texto)
        except ValueError:
            messagebox.showwarning(
                "Fecha inválida", "Escribe la fecha como AAAA-MM-DD, ej. 2025-06-13."
            )
            return None

        if not descripcion:
            messagebox.showwarning("Falta descripción", "Escribe una descripción.")
            return None

        try:
            monto = Decimal(monto_texto)
            if monto <= 0:
                raise InvalidOperation
        except InvalidOperation:
            messagebox.showwarning(
                "Monto inválido",
                "Escribe el monto como un número positivo, sin signo, ej. 199.00.",
            )
            return None

        pagina = 0
        if pagina_texto:
            try:
                pagina = int(pagina_texto)
            except ValueError:
                messagebox.showwarning(
                    "Página inválida", "La página debe ser un número entero."
                )
                return None

        return {
            "fecha": fecha,
            "descripcion": descripcion,
            "monto": monto,
            "tipo": tipo,
            "pagina": pagina,
            "tarjeta": tarjeta,
            "categoria": categoria,
            "comercio": comercio,
        }

    def _guardar_edicion(self) -> None:
        original = self.editando
        assert original is not None
        transacciones = self.master_app.transacciones
        # Por identidad, no por índice ni igualdad: si mientras esta ventana
        # estaba abierta se recargó el PDF o se borró otro renglón, el índice
        # ya no apuntaría al mismo renglón.
        indice = next((i for i, t in enumerate(transacciones) if t is original), None)
        if indice is None:
            messagebox.showwarning(
                "Renglón no encontrado",
                "Ese renglón ya no está en la tabla (¿recargaste el PDF?). "
                "Cierra esta ventana y vuelve a abrirlo desde la tabla.",
            )
            return
        valores = self._leer_formulario()
        if valores is None:
            return

        # `linea_cruda` NO se reconstruye con los valores corregidos: junto con
        # `pagina` es la llave del upsert en Supabase, así que conservarla hace
        # que re-sincronizar ACTUALICE el renglón ya subido en vez de dejar el
        # equivocado y crear otro (el sincronizador nunca borra filas viejas).
        linea_cruda = original.linea_cruda
        if valores["pagina"] != original.pagina:
            existentes = {
                t.linea_cruda
                for t in transacciones
                if t is not original and t.pagina == valores["pagina"]
            }
            base = linea_cruda
            ocurrencia = 2
            while linea_cruda in existentes:
                linea_cruda = f"{base} ({ocurrencia})"
                ocurrencia += 1
            messagebox.showwarning(
                "Cambiaste la página",
                "La página es parte de la llave con la que se sincroniza a Supabase. "
                "Si este documento ya estaba sincronizado, el renglón con la página "
                "anterior se quedará allá además del corregido; bórralo a mano en "
                "Supabase (Table Editor, tabla transacciones).",
            )

        transacciones[indice] = replace(original, linea_cruda=linea_cruda, **valores)
        self.master_app._refrescar_tabla()
        self.master_app._actualizar_totales()
        self.master_app.boton_guardar.config(state="normal")
        self.destroy()

    def _agregar(self) -> None:
        valores = self._leer_formulario()
        if valores is None:
            return
        fecha = valores["fecha"]
        descripcion = valores["descripcion"]
        monto = valores["monto"]
        tipo = valores["tipo"]
        pagina = valores["pagina"]
        categoria = valores["categoria"]
        comercio = valores["comercio"]
        tarjeta = valores["tarjeta"]

        # linea_cruda deja explícito que este renglón no vino del PDF -- y
        # lo hace único por (fecha, descripción, monto, tipo) para no
        # chocar con el constraint (documento_id, pagina, linea_cruda) del
        # upsert si se agrega más de un renglón manual al mismo documento.
        linea_cruda = f"{PREFIJO_RENGLON_MANUAL}{fecha.isoformat()} | {descripcion} | {monto} | {tipo}"
        # Dos renglones manuales idénticos (p. ej. dos casetas iguales el
        # mismo día, ambas ilegibles en el PDF) chocarían en ese constraint y
        # Postgres rechazaría el documento COMPLETO al sincronizar -- mismo
        # problema y misma solución que _desambiguar_renglones_duplicados
        # para las filas extraídas: sufijo " (2)", " (3)", ...
        existentes = {
            t.linea_cruda for t in self.master_app.transacciones if t.pagina == pagina
        }
        if linea_cruda in existentes:
            ocurrencia = 2
            while f"{linea_cruda} ({ocurrencia})" in existentes:
                ocurrencia += 1
            linea_cruda = f"{linea_cruda} ({ocurrencia})"

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
        self.combo_tarjeta.set(self.SIN_TARJETA)
        self.combo_categoria.set("")
        self.combo_comercio.set("")
        self._categoria_editada = False
        self._comercio_editado = False
        self._categoria_inferida = ""
        self._comercio_inferido = ""

        # La línea faltante que este renglón cubre ya no está pendiente:
        # se quita de las sugerencias y el diálogo salta a la siguiente
        # fecha detectada (con su página/tarjeta), si queda alguna.
        indice = next(
            (i for i, s in enumerate(self.sugerencias) if s[0] == fecha.isoformat()), None
        )
        if indice is not None:
            del self.sugerencias[indice]
        self.combo_fecha.configure(values=self._fechas_sugeridas())
        self.combo_tarjeta.configure(values=self._opciones_tarjeta())
        self.combo_categoria.configure(values=self._opciones_categoria())
        self.combo_comercio.configure(values=self._opciones_comercio())
        if self.sugerencias:
            self._aplicar_sugerencia(primera=True)

        messagebox.showinfo(
            "Renglón agregado",
            f"Se agregó: {fecha.isoformat()} · {descripcion} · {tipo} {monto} "
            f"(categoría: {categoria or '(sin categoría)'})",
        )


class VentanaCategoriaManual(tk.Toplevel):
    """Cambia a mano la categoría/comercio de uno o varios renglones, sin
    crear una regla: para casos muy específicos (p. ej. "CIERRE COMPRA DIF",
    que el usuario sabe que es Apple pero que como regla atraparía cualquier
    compra diferida). Solo categoría y comercio: fecha, monto y descripción
    vienen del PDF y no se tocan (auditoría).

    El cambio se guarda en el JSON procesado (`"categoria_manual": true`) y
    sobrevive a "Recargar reglas" y a volver a cargar el mismo PDF (ver
    `App.categorias_manuales`)."""

    def __init__(self, master: "App", indices: list[int]) -> None:
        super().__init__(master)
        self.master_app = master
        self.indices = indices
        transacciones = [master.transacciones[i] for i in indices]
        self.title("Cambiar categoría")
        self.transient(master)
        self.resizable(False, False)

        marco = ttk.Frame(self, padding=14)
        marco.pack(fill="both", expand=True)

        if len(transacciones) == 1:
            t = transacciones[0]
            detalle = f"{t.fecha.isoformat()} · {t.descripcion} · {t.tipo} ${t.monto:,.2f}"
        else:
            detalle = f"{len(transacciones)} renglones seleccionados"
        ttk.Label(marco, text=detalle, style="Seccion.TLabel", wraplength=460).grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, 10)
        )

        categorias = sorted(
            {t.categoria for t in master.transacciones if t.categoria}
            | {r.categoria for r in master.reglas}
        )
        comercios = sorted(
            {t.comercio for t in master.transacciones if t.comercio}
            | {r.comercio for r in master.reglas if r.comercio}
        )
        ttk.Label(marco, text="Categoría:").grid(row=1, column=0, sticky="w", pady=3)
        self.combo_categoria = ttk.Combobox(marco, values=categorias, width=40)
        self.combo_categoria.grid(row=1, column=1, sticky="ew", padx=(8, 0))
        ttk.Label(marco, text="Comercio (opcional):").grid(row=2, column=0, sticky="w", pady=3)
        self.combo_comercio = ttk.Combobox(marco, values=comercios, width=40)
        self.combo_comercio.grid(row=2, column=1, sticky="ew", padx=(8, 0))
        primero = transacciones[0]
        self.combo_categoria.set(primero.categoria or "")
        self.combo_comercio.set(primero.comercio or "")

        ttk.Label(
            marco,
            text=(
                "No crea una regla: solo cambia este renglón. Se conserva al recargar "
                "reglas o volver a cargar este PDF (después de guardar)."
            ),
            style="Ayuda.TLabel",
            wraplength=460,
        ).grid(row=3, column=0, columnspan=2, sticky="w", pady=(10, 0))

        botones = ttk.Frame(marco)
        botones.grid(row=4, column=0, columnspan=2, sticky="ew", pady=(14, 0))
        ttk.Button(botones, text="Guardar", style="Primario.TButton", command=self._guardar).pack(
            side="right"
        )
        ttk.Button(botones, text="Cancelar", command=self.destroy).pack(side="right", padx=(0, 6))
        if any(master.tiene_categoria_manual(t) for t in transacciones):
            ttk.Button(
                botones, text="Volver a la regla", command=self._volver_a_la_regla
            ).pack(side="left")

        self.bind("<Return>", lambda _e: self._guardar())
        self.bind("<Escape>", lambda _e: self.destroy())
        self.combo_categoria.focus_set()
        self.grab_set()

    def _guardar(self) -> None:
        categoria = self.combo_categoria.get().strip()
        comercio = self.combo_comercio.get().strip() or None
        if not categoria:
            messagebox.showwarning(
                "Falta la categoría",
                "Escribe o elige una categoría (o usa \"Volver a la regla\").",
                parent=self,
            )
            return
        self.master_app.asignar_categoria_manual(self.indices, categoria, comercio)
        self.destroy()

    def _volver_a_la_regla(self) -> None:
        self.master_app.quitar_categoria_manual(self.indices)
        self.destroy()
