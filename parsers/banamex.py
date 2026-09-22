"""Extractor para estados de cuenta Banamex (ej. Cuenta Priority).

A diferencia de lo que la vista del PDF sugiere, `pagina.extract_tables()`
no detecta nada en este layout (confirmado con el inspector de la app: 0
tablas en casi todas las páginas) — no hay líneas de cuadrícula reales que
pdfplumber pueda usar, aunque visualmente se vea como una tabla con
columnas FECHA | CONCEPTO | RETIROS | DEPOSITOS | SALDO. Este extractor
trabaja sobre `extract_text()` (texto plano) en su lugar.

Estructura real (confirmada con datos anonimizados de un estado de cuenta
real): cada transacción empieza con una línea "DD MES" (ej. "02 JUN"),
seguida de N líneas de concepto sin fecha, y termina en una línea que
trae DOS montos al final — "<lo que sea> <monto> <saldo>". El primer
monto es el que aparece en la columna RETIROS o DEPÓSITOS (ambigua sin
posición de columna); el segundo es siempre el saldo corriente.

Una transacción puede partirse entre el final de una página y el
principio de la siguiente (el PDF no repite la fecha en la continuación)
— por eso este extractor procesa TODO el documento como un solo flujo de
líneas, sin reiniciar nada en los saltos de página.

CLAVE DE DISEÑO — por qué el signo (cargo/abono) se calcula por DELTA DE
SALDO y no por el monto impreso ni por palabras del concepto: en estados
reales se ve, por ejemplo, "CREDITO NOMINA BANAMEX ... A SU TC" con el
saldo BAJANDO (es un cargo automático a tarjeta de crédito, no un
depósito, pese al nombre "CREDITO"). El texto del concepto no es
confiable. En cambio saldo_nuevo - saldo_anterior siempre da el monto y
signo correctos, porque el estado de cuenta lo reporta explícitamente en
cada línea. Este extractor ancla saldo_anterior en la línea "SALDO
ANTERIOR" y de ahí en adelante deriva cada monto del delta, ignorando el
monto impreso salvo para quitarlo del texto del concepto.

IMPORTANTE — el año: el PDF no imprime el año en cada renglón, solo
"DD MES". `extraer()` lo detecta solo desde la portada ("Fecha de corte"
o "Periodo" traen el año completo) y sobreescribe `ano_estado_de_cuenta`
antes de procesar las transacciones — el valor que llega por parámetro
(desde el campo "Año" de la app) es solo el respaldo si la detección
falla. Límite conocido: si el periodo del estado de cuenta cruza un
cambio de año (ej. del 15 de diciembre al 14 de enero), todas las
transacciones se etiquetan con el mismo año detectado (el de la fecha
de corte) — las de diciembre quedarían con el año equivocado. No se ha
visto este caso en la práctica; si aparece, hay que separar la
detección por transacción en vez de una sola vez por documento.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pdfplumber

from parsers.base import BaseParser, RenglonCrudo

MESES = {
    "ENE": "01", "FEB": "02", "MAR": "03", "ABR": "04",
    "MAY": "05", "JUN": "06", "JUL": "07", "AGO": "08",
    "SEP": "09", "OCT": "10", "NOV": "11", "DIC": "12",
}

# Fecha al INICIO de la línea, seguida del resto del contenido de esa
# misma línea (a diferencia de una celda de tabla, aquí todo va en una
# sola línea de texto plano).
PATRON_FECHA_PREFIJO = re.compile(r"^(\d{2})\s+([A-ZÁÉÍÓÚ]{3})\s+(.*)$")

# Una línea "cierra" un bloque si termina en dos montos: "<resto> <monto> <saldo>".
PATRON_DOS_MONTOS = re.compile(
    r"^(?P<resto>.*?)\s*(?P<monto>-?[\d,]+\.\d{2})\s+(?P<saldo>-?[\d,]+\.\d{2})\s*$"
)

# Portada (página 1): "Cuenta <Tipo>" (ej. "Cuenta Priority") — distinta de
# "Número de cuenta de cheques...", que siempre trae más texto alrededor.
# Usamos esto como alias automático de la cuenta. Confirmado 2026-09-21
# contra una cuenta Priority real: "Cuenta Priority" no siempre está sola en
# su propia línea -- pdfplumber a veces la pega al final de la línea de
# domicilio de la sucursal ("...MEXICO C.P.01234 Cuenta Priority"), por eso
# el patrón busca el final de la línea (`$`) en vez de exigir que sea la
# línea completa (`^...$`); así funciona en ambos casos.
PATRON_ALIAS = re.compile(r"Cuenta\s+[A-Za-zÁÉÍÓÚáéíóú]+(?:\s+[A-Za-zÁÉÍÓÚáéíóú]+)?$")

# "Número de cuenta de cheques <11 dígitos>" — de ahí solo nos quedamos con
# los últimos 4; el resto del número nunca se guarda en ninguna variable
# que sobreviva esta función.
PATRON_CUENTA_CHEQUES = re.compile(r"cuenta de cheques\s+(\d+)", re.IGNORECASE)

# "Fecha de corte ... 30 de junio de 2025" / "Periodo Del 1 al 30 de junio
# del 2025" — cualquiera de las dos trae el año en texto plano en la misma
# línea.
PATRON_LINEA_CON_ANIO = re.compile(r"FECHA DE CORTE|PERIODO|PER[ÍI]ODO", re.IGNORECASE)


def _a_decimal(texto: str) -> Decimal:
    return Decimal(texto.replace(",", ""))


class BanamexParser(BaseParser):
    nombre_banco = "Banamex"

    def __init__(self, ano_estado_de_cuenta: str = "2025") -> None:
        # El PDF no trae el año en cada renglón — ver docstring del módulo.
        self.ano_estado_de_cuenta = ano_estado_de_cuenta

    def extraer(self, ruta_pdf: Path) -> list[RenglonCrudo]:
        lineas_documento: list[tuple[int, str]] = []
        with pdfplumber.open(ruta_pdf) as pdf:
            for numero_pagina, pagina in enumerate(pdf.pages, start=1):
                texto = pagina.extract_text() or ""

                if numero_pagina == 1:
                    anio_detectado = self._detectar_anio(texto)
                    if anio_detectado:
                        # Pisa lo que haya llegado por parámetro/campo "Año"
                        # de la app -- el PDF es la fuente de verdad.
                        self.ano_estado_de_cuenta = anio_detectado

                for linea in texto.splitlines():
                    linea = linea.strip()
                    if linea:
                        lineas_documento.append((numero_pagina, linea))

        return self._procesar_documento(lineas_documento)

    def _detectar_anio(self, texto_portada: str) -> str | None:
        for linea in texto_portada.splitlines():
            if PATRON_LINEA_CON_ANIO.search(linea):
                coincidencia = re.search(r"\d{4}", linea)
                if coincidencia:
                    return coincidencia.group(0)
        return None

    def extraer_info_cuenta(self, ruta_pdf: Path) -> tuple[str | None, str | None]:
        alias: str | None = None
        ultimos_4: str | None = None

        with pdfplumber.open(ruta_pdf) as pdf:
            if not pdf.pages:
                return None, None
            texto_portada = pdf.pages[0].extract_text() or ""

        for linea in texto_portada.splitlines():
            linea = linea.strip()

            if alias is None:
                coincidencia_alias = PATRON_ALIAS.search(linea)
                if coincidencia_alias:
                    alias = coincidencia_alias.group(0)

            if ultimos_4 is None:
                coincidencia = PATRON_CUENTA_CHEQUES.search(linea)
                if coincidencia:
                    numero_completo = coincidencia.group(1)
                    if len(numero_completo) >= 4:
                        ultimos_4 = numero_completo[-4:]
                    # numero_completo no se guarda en ningún otro lado ni
                    # se propaga fuera de este bloque.

            if alias is not None and ultimos_4 is not None:
                break

        return alias, ultimos_4

    def puede_procesar(self, ruta_pdf: Path) -> bool:
        # "BANAMEX" solo no alcanza: Banamex también emite estados de
        # cuenta de tarjeta de crédito (ver parsers/banamex_tdc.py), que
        # también dicen "BANAMEX" en algún lado, así que ese solo causaría
        # ambigüedad entre los dos extractores. "FECHA CONCEPTO RETIROS"
        # es el encabezado de la tabla de movimientos de la cuenta de
        # cheques -- la TDC no lo trae (su detalle de operaciones no tiene
        # esas columnas). El logo de la portada (página 1) es una imagen,
        # no texto seleccionable, así que no basta con mirar solo esa página.
        try:
            with pdfplumber.open(ruta_pdf) as pdf:
                for pagina in pdf.pages[:3]:
                    texto = pagina.extract_text() or ""
                    texto_mayus = texto.upper()
                    if "BANAMEX" in texto_mayus and "FECHA CONCEPTO RETIROS" in texto_mayus:
                        return True
        except Exception:  # noqa: BLE001 — un PDF ilegible simplemente no matchea
            return False
        return False

    def _procesar_documento(
        self, lineas_documento: list[tuple[int, str]]
    ) -> list[RenglonCrudo]:
        renglones: list[RenglonCrudo] = []

        saldo_actual: Decimal | None = None
        bloque_fecha: str | None = None
        bloque_pagina: int | None = None
        bloque_concepto: list[str] = []
        bloque_lineas_crudas: list[str] = []

        def abrir_bloque(dia: str, mes_abrev: str, pagina: int) -> None:
            nonlocal bloque_fecha, bloque_pagina, bloque_concepto, bloque_lineas_crudas
            # Si el bloque anterior nunca cerró (línea rota / formato
            # inesperado), lo descartamos sin emitir en vez de arrastrar
            # texto de una transacción a la siguiente.
            mes = MESES.get(mes_abrev, "01")
            bloque_fecha = f"{dia}/{mes}/{self.ano_estado_de_cuenta}"
            bloque_pagina = pagina
            bloque_concepto = []
            bloque_lineas_crudas = []

        def cerrar_bloque_con_saldo(saldo_nuevo: Decimal) -> None:
            nonlocal saldo_actual, bloque_fecha, bloque_pagina
            nonlocal bloque_concepto, bloque_lineas_crudas

            if bloque_fecha is not None and saldo_actual is not None:
                delta = saldo_nuevo - saldo_actual
                if delta != 0:
                    renglones.append(
                        RenglonCrudo(
                            fecha_texto=bloque_fecha,
                            descripcion_texto=" ".join(bloque_concepto).strip(),
                            monto_texto=str(delta),
                            pagina=bloque_pagina or 1,
                            linea_cruda=" | ".join(bloque_lineas_crudas),
                        )
                    )

            saldo_actual = saldo_nuevo
            bloque_fecha = None
            bloque_pagina = None
            bloque_concepto = []
            bloque_lineas_crudas = []

        for numero_pagina, linea in lineas_documento:
            resto = linea
            match_fecha = PATRON_FECHA_PREFIJO.match(linea)
            if match_fecha:
                dia, mes_abrev, resto = match_fecha.groups()
                abrir_bloque(dia, mes_abrev, numero_pagina)

            bloque_lineas_crudas.append(linea)

            if resto.strip().upper().startswith("SALDO ANTERIOR"):
                # Ancla del saldo inicial — no es una transacción real.
                try:
                    saldo_texto = resto.strip().split()[-1]
                    saldo_actual = _a_decimal(saldo_texto)
                except (InvalidOperation, IndexError):
                    pass
                bloque_fecha = None
                bloque_pagina = None
                bloque_concepto = []
                bloque_lineas_crudas = []
                continue

            match_montos = PATRON_DOS_MONTOS.match(resto)
            if match_montos:
                texto_resto = match_montos.group("resto").strip()
                if texto_resto:
                    bloque_concepto.append(texto_resto)
                try:
                    saldo_nuevo = _a_decimal(match_montos.group("saldo"))
                except InvalidOperation:
                    continue
                cerrar_bloque_con_saldo(saldo_nuevo)
                continue

            if resto.strip():
                bloque_concepto.append(resto.strip())

        return renglones
