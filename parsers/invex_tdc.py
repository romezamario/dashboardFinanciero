"""Extractor para estados de cuenta de Tarjeta de Crédito Invex.

Segundo banco de tarjeta de crédito soportado (el primero fue Banamex TDC,
`parsers/banamex_tdc.py`) — estructuralmente muy similar (misma convención
de signo, mismo layout de una-transacción-una-línea con dos fechas), pero
NO es el mismo banco, así que va en su propio módulo en vez de intentar que
`BanamexTdcParser` cubra ambos.

Diferencias frente a Banamex TDC, confirmadas contra un estado de cuenta
real anonimizado (2026-09-21):

  - Las fechas vienen "DD-Mon-AAAA" con el mes abreviado y la primera letra
    en mayúscula (ej. "01-May-2026", "15-Jun-2026"), no en minúsculas como
    Banamex ("01-may-2026") -- el patrón de fecha en sí no distingue
    mayúsculas/minúsculas así que no afecta el regex, pero si alguna vez se
    necesita mostrar el mes tal cual venía del PDF (no es el caso aquí,
    `_normalizar_fecha` ya lo convierte a "DD/MM/AAAA"), hay que recordar
    que la grafía difiere entre bancos.
  - Mismo layout de una línea por transacción: "DD-Mon-AAAA DD-Mon-AAAA
    CONCEPTO CIUDAD +$MONTO" — la primera fecha es la de operación, la
    segunda la de cargo; se usa la primera como fecha de la transacción,
    igual que Banamex TDC usa la fecha de compra.
  - CONVENCIÓN DE SIGNO idéntica a Banamex TDC: "+" = cargo (una compra,
    aumenta lo que debes), "-" = abono (un pago, lo reduce). Confirmado
    contra un renglón "-" real: "SU PAGO POR SPEI_T 0032 - $X,XXX.XX".
  - No se detectó ningún concepto multilínea (equivalente al "PAGO
    INTERBANCARIO" de Banamex) en el único estado de cuenta real visto
    hasta ahora -- si aparece uno en el futuro, agregar ese manejo
    entonces (ver el módulo de Banamex TDC como referencia), no antes.
  - Tampoco se detectaron secciones "Tarjeta Titular/Adicional/Digital"
    repetidas -- solo una línea "Tarjeta Titular ************1234" que
    aparece una sola vez como encabezado de la tabla, no agrupando bloques
    distintos de transacciones. Por eso este extractor NO llena el campo
    `tarjeta` de `RenglonCrudo` (queda `None` en todas las filas, como
    cualquier extractor sin ese concepto) -- si un estado de cuenta real
    con tarjetas adicionales aparece, hay que confirmar la estructura real
    antes de copiar el manejo de `banamex_tdc.py`, no asumir que es igual.

RIESGO CONOCIDO en `puede_procesar` (sin confirmar todavía contra un PDF
real, solo contra el volcado anonimizado): se exige que aparezca la palabra
"INVEX" como texto seleccionable, para no colisionar con
`BanamexTdcParser.puede_procesar` -- ambos extractores de TDC dependen de
"Pago mínimo", que por sí solo NO alcanza para distinguir un banco de otro,
a diferencia de cuando se afinó el marcador de Banamex TDC (en ese momento
no había otro extractor de TDC con el que colisionar). Si "INVEX" resulta
ser parte de un logo (imagen, no texto seleccionable) como pasó con
"BANAMEX" en su propio estado de cuenta de TDC, la autodetección
simplemente nunca disparará para este banco (degradación segura: el
usuario elige "Invex TDC" a mano del dropdown) -- no hay riesgo de que
tome el extractor equivocado. Pendiente: confirmar con la primera carga
real si el banco se autodetecta solo o si hace falta ajustar el marcador
(lección ya documentada para Banamex TDC en su propio módulo).
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pdfplumber

from parsers.base import BaseParser, RenglonCrudo

MESES = {
    "ene": "01", "feb": "02", "mar": "03", "abr": "04",
    "may": "05", "jun": "06", "jul": "07", "ago": "08",
    "sep": "09", "oct": "10", "nov": "11", "dic": "12",
}

# "DD-Mon-AAAA DD-Mon-AAAA CONCEPTO...CIUDAD +$1,234.56" -- igual que en
# Banamex TDC, el final tolera puntos/espacios sueltos después del monto
# (`[\s.]*$` en vez de `\s*$`) por el mismo tipo de artefacto de pie de
# página pegado sin salto de línea (ver banamex_tdc.py) -- se agrega desde
# el inicio en vez de esperar a que vuelva a pasar con este banco.
PATRON_TRANSACCION = re.compile(
    r"^(?P<fecha_operacion>\d{2}-[a-zA-Z]{3}-\d{4})\s+"
    r"(?P<fecha_cargo>\d{2}-[a-zA-Z]{3}-\d{4})\s+"
    r"(?P<concepto>.+?)\s+"
    r"(?P<signo>[+-])\s*\$\s*(?P<monto>[\d,]+\.\d{2})[\s.]*$"
)

# Mismo propósito que en banamex_tdc.py: detecta filas que SÍ son una
# transacción (traen las dos fechas) pero cuyo concepto/monto no se pudo
# leer completo, para avisar en vez de perder la fila en silencio.
PATRON_PREFIJO_FECHAS = re.compile(
    r"^\d{2}-[a-zA-Z]{3}-\d{4}\s+\d{2}-[a-zA-Z]{3}-\d{4}"
)

# Bank name -- ver el riesgo documentado en el docstring del módulo.
PATRON_INVEX = re.compile(r"invex", re.IGNORECASE)

# "Pago mínimo" es específico de un estado de cuenta de tarjeta de crédito.
# Por sí solo NO es suficiente para distinguir Invex de Banamex TDC (los
# dos lo traen) -- por eso puede_procesar exige también PATRON_INVEX.
PATRON_PAGO_MINIMO = re.compile(r"pago\s+m[ií]nimo", re.IGNORECASE)

# "Número de la tarjeta XXXX XXXX XXXX 1234" en la portada -- nos quedamos
# solo con el run de dígitos más largo de la línea (el número de tarjeta
# real casi siempre es el único grupo de 4+ dígitos; el resto de la línea,
# si trae un monto en la misma línea física, produce grupos más cortos por
# las comas/puntos del formato de moneda). Mismo truco que banamex_tdc.py.
PATRON_LINEA_TARJETA = re.compile(r"n[uú]mero de la tarjeta", re.IGNORECASE)


def _a_decimal(texto: str) -> Decimal:
    return Decimal(texto.replace(",", ""))


class InvexTdcParser(BaseParser):
    nombre_banco = "Invex TDC"

    def __init__(self) -> None:
        self._advertencias: list[str] = []

    def extraer(self, ruta_pdf: Path) -> list[RenglonCrudo]:
        renglones: list[RenglonCrudo] = []
        self._advertencias = []

        with pdfplumber.open(ruta_pdf) as pdf:
            for numero_pagina, pagina in enumerate(pdf.pages, start=1):
                texto = pagina.extract_text() or ""

                for linea in texto.splitlines():
                    linea = linea.strip()
                    if not linea:
                        continue

                    coincidencia = PATRON_TRANSACCION.match(linea)
                    if not coincidencia:
                        if PATRON_PREFIJO_FECHAS.match(linea):
                            self._advertencias.append(
                                f"Página {numero_pagina}: fila con fecha de "
                                f"transacción pero sin concepto/monto legible "
                                f"(probablemente texto renderizado como imagen "
                                f"en el PDF) — revísala a mano: {linea!r}"
                            )
                        continue

                    try:
                        monto = _a_decimal(coincidencia.group("monto"))
                    except InvalidOperation:
                        continue

                    signo_pdf = coincidencia.group("signo")
                    # Ver convención de signo en el docstring del módulo.
                    monto_texto = f"-{monto}" if signo_pdf == "+" else str(monto)

                    fecha_texto = self._normalizar_fecha(
                        coincidencia.group("fecha_operacion")
                    )
                    if fecha_texto is None:
                        continue

                    renglones.append(
                        RenglonCrudo(
                            fecha_texto=fecha_texto,
                            descripcion_texto=coincidencia.group("concepto").strip(),
                            monto_texto=monto_texto,
                            pagina=numero_pagina,
                            linea_cruda=linea,
                        )
                    )

        return renglones

    def advertencias(self) -> list[str]:
        return list(self._advertencias)

    def _normalizar_fecha(self, fecha_dd_mon_aaaa: str) -> str | None:
        partes = fecha_dd_mon_aaaa.split("-")
        if len(partes) != 3:
            return None
        dia, mes_abrev, anio = partes
        mes = MESES.get(mes_abrev.lower())
        if mes is None:
            return None
        return f"{dia}/{mes}/{anio}"

    def extraer_info_cuenta(self, ruta_pdf: Path) -> tuple[str | None, str | None]:
        ultimos_4: str | None = None

        with pdfplumber.open(ruta_pdf) as pdf:
            for pagina in pdf.pages[:3]:
                texto = pagina.extract_text() or ""

                for linea in texto.splitlines():
                    linea = linea.strip()

                    if ultimos_4 is None and PATRON_LINEA_TARJETA.search(linea):
                        digitos = re.findall(r"\d+", linea)
                        if digitos:
                            numero_completo = max(digitos, key=len)
                            if len(numero_completo) >= 4:
                                ultimos_4 = numero_completo[-4:]
                            # numero_completo no se guarda en ningún otro
                            # lado ni se propaga fuera de este bloque.

                if ultimos_4 is not None:
                    break

        # Sin tiers conocidos (a diferencia de Banamex TDC Platino/Beyond) --
        # alias fijo mientras no se confirme lo contrario contra otro estado
        # de cuenta real.
        alias = "Invex TDC" if ultimos_4 is not None else None
        return alias, ultimos_4

    def puede_procesar(self, ruta_pdf: Path) -> bool:
        try:
            with pdfplumber.open(ruta_pdf) as pdf:
                texto_acumulado = "\n".join(
                    pagina.extract_text() or "" for pagina in pdf.pages[:2]
                )
        except Exception:  # noqa: BLE001 — un PDF ilegible simplemente no matchea
            return False
        return bool(
            PATRON_INVEX.search(texto_acumulado)
            and PATRON_PAGO_MINIMO.search(texto_acumulado)
        )
