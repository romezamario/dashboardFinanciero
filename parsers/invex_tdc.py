"""Extractor para estados de cuenta de Tarjeta de Crédito Invex.

Segundo banco de tarjeta de crédito soportado (el primero fue Banamex TDC,
`parsers/banamex_tdc.py`) — pero NO es el mismo banco, así que va en su
propio módulo en vez de intentar que `BanamexTdcParser` cubra ambos.

**Dos formatos de documento distintos bajo el mismo banco** (confirmado
2026-09-22): a diferencia de Banamex, donde un solo formato de transacción
cubre todos los tiers de TDC (ver la lección "One parser class covers
every TDC tier" en `banamex_tdc.py`), Invex resultó traer dos plantillas
de estado de cuenta estructuralmente distintas para lo que sigue siendo el
mismo producto (tarjeta de crédito) -- no se sabe todavía si la diferencia
es por antigüedad de la cuenta, tipo de tarjeta, o una migración de
plantilla del banco a través del tiempo. `extraer()` intenta el patrón V1
primero y si no matchea prueba V2 en la misma línea, así que un documento
con páginas de ambos formatos (no visto todavía, pero no descartado)
funcionaría igual:

  - **V1** (primer estado de cuenta visto, 2026-09-21): "DD-Mon-AAAA
    DD-Mon-AAAA CONCEPTO CIUDAD +$MONTO" -- dos fechas (operación y cargo,
    se usa la primera), mes abreviado con mayúscula inicial ("01-May-2026"),
    signo `+`/`-` explícito antes del monto: `+` = cargo, `-` = abono.
    Confirmado contra un renglón real: `"SU PAGO POR SPEI_T 0032 - $X,XXX.XX"`.
  - **V2** (segundo estado de cuenta visto, 2026-09-22): "DD/MM/AAAA
    CONCEPTO $MONTO[ CR]" -- una sola fecha con diagonales (no guion+mes
    abreviado), **sin signo `+`/`-` visible en el texto** -- en su lugar,
    un abono trae el sufijo literal `"CR"` después del monto y un cargo no
    trae nada. Confirmado por el usuario tras preguntarle explícitamente
    (no se podía inferir del volcado anonimizado, que oculta letras):
    `"CR"` = abono (crédito a favor, reduce lo que debes), sin sufijo =
    cargo. Nótese que es la relación *inversa* de dónde vive la marca
    respecto a V1 (ahí el signo marca el cargo con un símbolo explícito;
    aquí es la *ausencia* de sufijo la que indica cargo) -- fácil de
    invertir por error, revisar con cuidado si se vuelve a tocar esto.
    V2 también intercala líneas eco tipo "XXXXXX XXXX XXXXXX ... $0.00"
    después de varias transacciones (probablemente una nota de tipo de
    cambio o de puntos, texto exacto no confirmado) -- como matchean el
    mismo patrón de transacción y casi siempre traen `$0.00`, se dejan
    pasar como renglones normales en vez de intentar filtrarlas por
    adivinanza; no afectan el total porque son cero.
  - Fecha normalizada a `DD/MM/AAAA` en ambos casos -- V1 vía el mismo
    truco `MESES` que Banamex TDC (`strptime` con `%b` es dependiente del
    locale del sistema, no confiar en él); V2 ya viene en ese formato
    exacto del PDF, sin conversión.
  - No se detectó ningún concepto multilínea (equivalente al "PAGO
    INTERBANCARIO" de Banamex) en ninguno de los dos formatos vistos hasta
    ahora -- si aparece uno en el futuro, agregar ese manejo entonces (ver
    el módulo de Banamex TDC como referencia), no antes.
  - **`tarjeta` (Titular/Adicional) SÍ agrupa secciones**, confirmado
    2026-09-22 contra un estado de cuenta V2 con tarjeta adicional -- la
    suposición inicial de que Invex no repetía secciones era prematura,
    solo faltaba ver un estado de cuenta con más de una tarjeta. El texto
    disponible para identificar cada sección difiere por formato: V1
    imprime el rol como palabra (`"Tarjeta Titular ************1234 ..."`,
    `PATRON_SECCION_TARJETA_CON_ROL`, igual que Banamex); V2 NO imprime
    ningún rol -- solo `"************1234 NOMBRE APELLIDO"` (el nombre del
    tarjetahabiente, confirmado contra el volcado real que no hay ninguna
    palabra "Titular"/"Adicional" en esa línea). Cuál tarjeta física es
    "la titular" y cuál "la adicional" es algo que el dueño de la cuenta
    sabe, no algo que el PDF diga en texto -- así que para V2 el campo
    `tarjeta` cae a los últimos 4 dígitos mismos como identificador
    (`"1096"`, `"5005"`) en vez de un nombre de rol. `PATRON_TARJETA_ENMASCARADA`
    (la misma que usa `extraer_info_cuenta` para el últimos-4 de la
    cuenta) hace doble función como detector de encabezado de sección
    cuando matchea con `.match()` anclado al inicio de línea -- una
    transacción nunca empieza con asteriscos, así que no hay riesgo de
    confundir una cosa con la otra.

**Alias/últimos 4 dígitos**: el primer estado de cuenta (V1) traía la
etiqueta "No. Tarjeta XXXX XXXX XXXX 1234" en la portada; el segundo (V2)
NO trae esa etiqueta en absoluto en su portada -- en su lugar hay una línea
suelta de dígitos sin etiquetar cuyo significado no se confirmó (podría ser
el número de tarjeta completo o podría ser otra cosa; no vale la pena
adivinar cuando hay una fuente mejor). Lo confiable en **ambos** formatos
es la línea de la tabla de movimientos con el número enmascarado con
asteriscos, `"************1234 ..."` (12 asteriscos + últimos 4 dígitos
reales) -- `extraer_info_cuenta` la busca primero
(`PATRON_TARJETA_ENMASCARADA`) y solo si no la encuentra cae al método
anterior basado en la etiqueta "No. Tarjeta"/"Número de la tarjeta" de la
portada (que sigue funcionando para V1).

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

# V1: "DD-Mon-AAAA DD-Mon-AAAA CONCEPTO...CIUDAD +$1,234.56" -- igual que en
# Banamex TDC, el final tolera puntos/espacios sueltos después del monto
# (`[\s.]*$` en vez de `\s*$`) por el mismo tipo de artefacto de pie de
# página pegado sin salto de línea (ver banamex_tdc.py) -- se agrega desde
# el inicio en vez de esperar a que vuelva a pasar con este banco.
PATRON_TRANSACCION_V1 = re.compile(
    r"^(?P<fecha_operacion>\d{2}-[a-zA-Z]{3}-\d{4})\s+"
    r"(?P<fecha_cargo>\d{2}-[a-zA-Z]{3}-\d{4})\s+"
    r"(?P<concepto>.+?)\s+"
    r"(?P<signo>[+-])\s*\$\s*(?P<monto>[\d,]+\.\d{2})[\s.]*$"
)

# Mismo propósito que en banamex_tdc.py: detecta filas que SÍ son una
# transacción V1 (traen las dos fechas) pero cuyo concepto/monto no se pudo
# leer completo, para avisar en vez de perder la fila en silencio.
PATRON_PREFIJO_FECHAS_V1 = re.compile(
    r"^\d{2}-[a-zA-Z]{3}-\d{4}\s+\d{2}-[a-zA-Z]{3}-\d{4}"
)

# V2: "DD/MM/AAAA CONCEPTO...$1,234.56[ CR]" -- una sola fecha, sin signo
# explícito; "CR" (crédito) tras el monto marca un abono, su ausencia
# marca un cargo -- ver la explicación larga en el docstring del módulo
# sobre por qué esta convención es la inversa de dónde vive la marca en
# V1. `re.IGNORECASE` solo importa para el "CR" (por si el PDF real lo
# imprime en minúsculas alguna vez); el resto del patrón no tiene letras
# cuyo case dependa de la bandera.
PATRON_TRANSACCION_V2 = re.compile(
    r"^(?P<fecha>\d{2}/\d{2}/\d{4})\s+"
    r"(?P<concepto>.+?)\s+"
    r"\$(?P<monto>[\d,]+\.\d{2})"
    r"(?P<credito>\s+CR)?"
    r"[\s.]*$",
    re.IGNORECASE,
)

# Mismo propósito que PATRON_PREFIJO_FECHAS_V1 pero para el formato V2 de
# una sola fecha.
PATRON_PREFIJO_FECHA_V2 = re.compile(r"^\d{2}/\d{2}/\d{4}\s")

# Bank name -- ver el riesgo documentado en el docstring del módulo.
PATRON_INVEX = re.compile(r"invex", re.IGNORECASE)

# "Pago mínimo" es específico de un estado de cuenta de tarjeta de crédito.
# Por sí solo NO es suficiente para distinguir Invex de Banamex TDC (los
# dos lo traen) -- por eso puede_procesar exige también PATRON_INVEX.
PATRON_PAGO_MINIMO = re.compile(r"pago\s+m[ií]nimo", re.IGNORECASE)

# Fuente PRIMARIA de últimos 4 dígitos -- confirmada presente en AMBOS
# formatos de documento (V1 y V2) en la tabla de movimientos, a diferencia
# de la etiqueta de portada que cambió entre uno y otro (ver docstring del
# módulo): "************1234 ..." -- 4 o más asteriscos seguidos de
# exactamente 4 dígitos, sin ambigüedad posible con ningún otro número de
# la línea (montos, CLABE, etc. no usan asteriscos).
PATRON_TARJETA_ENMASCARADA = re.compile(r"\*{4,}(\d{4})\b")

# Encabezado de sección de tarjeta dentro de la tabla de movimientos --
# confirmado (2026-09-22) que un documento con tarjeta titular + adicional
# agrupa sus transacciones igual que Banamex TDC, pero el texto disponible
# para identificar cada sección difiere según el formato:
#   - V1: imprime el rol como palabra, "Tarjeta Titular ************1234
#     ..." -- se captura "Titular"/"Adicional"/"Digital" tal cual Banamex.
#   - V2: NO imprime ningún rol, solo "************1234 NOMBRE APELLIDO"
#     (el nombre del tarjetahabiente, sin la palabra "Titular"/"Adicional"
#     en ningún lado de esa línea, confirmado contra el volcado real) --
#     ahí no hay nada legible que sirva de rol, así que se usan los
#     últimos 4 dígitos mismos como identificador de tarjeta. Cuál número
#     corresponde a "la titular" o "la adicional" es algo que el usuario
#     sabe por su propia cuenta, no algo que este documento diga en texto
#     -- no lo adivinamos ni lo hardcodeamos aquí.
# Se intenta la variante V1 primero (más legible) y solo si no matchea se
# cae al número enmascarado solo.
PATRON_SECCION_TARJETA_CON_ROL = re.compile(
    r"^Tarjeta\s+(Titular|Adicional|Digital)\b", re.IGNORECASE
)

# Fuente DE RESPALDO, solo para V1 -- ver el docstring del módulo. La
# portada de V1 dice "No. Tarjeta XXXX XXXX XXXX 1234 ..."; V2 no tiene
# esta etiqueta en absoluto, así que `extraer_info_cuenta` solo llega aquí
# si `PATRON_TARJETA_ENMASCARADA` no encontró nada. Acepta ambas formas
# ("No. Tarjeta" y "Número de la tarjeta") por si un futuro estado de
# cuenta trae la otra grafía. Nos quedamos solo con el run de dígitos más
# largo de la línea (el número de tarjeta real casi siempre es el único
# grupo de 4+ dígitos; el resto de la línea, si trae un monto en la misma
# línea física como pasa aquí, produce grupos más cortos por las
# comas/puntos del formato de moneda). Mismo truco que banamex_tdc.py.
PATRON_LINEA_TARJETA = re.compile(
    r"no\.?\s*tarjeta|n[uú]mero de la tarjeta", re.IGNORECASE
)


def _a_decimal(texto: str) -> Decimal:
    return Decimal(texto.replace(",", ""))


class InvexTdcParser(BaseParser):
    nombre_banco = "Invex TDC"

    def __init__(self) -> None:
        self._advertencias: list[str] = []

    def extraer(self, ruta_pdf: Path) -> list[RenglonCrudo]:
        renglones: list[RenglonCrudo] = []
        self._advertencias = []
        # Estado del documento completo, no por página -- una sección de
        # tarjeta sigue vigente a través de un salto de página, igual que
        # en banamex_tdc.py.
        tarjeta_actual: str | None = None

        with pdfplumber.open(ruta_pdf) as pdf:
            for numero_pagina, pagina in enumerate(pdf.pages, start=1):
                texto = pagina.extract_text() or ""

                for linea in texto.splitlines():
                    linea = linea.strip()
                    if not linea:
                        continue

                    coincidencia_rol = PATRON_SECCION_TARJETA_CON_ROL.match(linea)
                    if coincidencia_rol:
                        tarjeta_actual = coincidencia_rol.group(1).capitalize()
                        continue

                    coincidencia_mascara_seccion = PATRON_TARJETA_ENMASCARADA.match(linea)
                    if coincidencia_mascara_seccion:
                        tarjeta_actual = coincidencia_mascara_seccion.group(1)
                        continue

                    coincidencia_v1 = PATRON_TRANSACCION_V1.match(linea)
                    if coincidencia_v1:
                        try:
                            monto = _a_decimal(coincidencia_v1.group("monto"))
                        except InvalidOperation:
                            continue

                        signo_pdf = coincidencia_v1.group("signo")
                        # Ver convención de signo (V1) en el docstring del módulo.
                        monto_texto = f"-{monto}" if signo_pdf == "+" else str(monto)

                        fecha_texto = self._normalizar_fecha_v1(
                            coincidencia_v1.group("fecha_operacion")
                        )
                        if fecha_texto is None:
                            continue

                        renglones.append(
                            RenglonCrudo(
                                fecha_texto=fecha_texto,
                                descripcion_texto=coincidencia_v1.group("concepto").strip(),
                                monto_texto=monto_texto,
                                pagina=numero_pagina,
                                linea_cruda=linea,
                                tarjeta=tarjeta_actual,
                            )
                        )
                        continue

                    coincidencia_v2 = PATRON_TRANSACCION_V2.match(linea)
                    if coincidencia_v2:
                        try:
                            monto = _a_decimal(coincidencia_v2.group("monto"))
                        except InvalidOperation:
                            continue

                        # Ver convención de signo (V2, inversa de V1) en el
                        # docstring del módulo: "CR" = abono, sin sufijo = cargo.
                        es_abono = coincidencia_v2.group("credito") is not None
                        monto_texto = str(monto) if es_abono else f"-{monto}"

                        renglones.append(
                            RenglonCrudo(
                                fecha_texto=coincidencia_v2.group("fecha"),
                                descripcion_texto=coincidencia_v2.group("concepto").strip(),
                                monto_texto=monto_texto,
                                pagina=numero_pagina,
                                linea_cruda=linea,
                                tarjeta=tarjeta_actual,
                            )
                        )
                        continue

                    if PATRON_PREFIJO_FECHAS_V1.match(linea) or PATRON_PREFIJO_FECHA_V2.match(
                        linea
                    ):
                        self._advertencias.append(
                            f"Página {numero_pagina}: fila con fecha de "
                            f"transacción pero sin concepto/monto legible "
                            f"(probablemente texto renderizado como imagen "
                            f"en el PDF) — revísala a mano: {linea!r}"
                        )

        return renglones

    def advertencias(self) -> list[str]:
        return list(self._advertencias)

    def _normalizar_fecha_v1(self, fecha_dd_mon_aaaa: str) -> str | None:
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

                    # Fuente primaria (V1 y V2): ver docstring del módulo.
                    if ultimos_4 is None:
                        coincidencia_mascara = PATRON_TARJETA_ENMASCARADA.search(linea)
                        if coincidencia_mascara:
                            ultimos_4 = coincidencia_mascara.group(1)

                    # Fuente de respaldo, solo aplica a V1 -- ver docstring.
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
