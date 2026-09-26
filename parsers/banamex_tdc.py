"""Extractor para estados de cuenta de Tarjeta de Crédito Banamex (Platino,
Beyond, y presumiblemente cualquier otro tier -- ver `TIPOS_TARJETA_CONOCIDOS`,
confirmado que comparten el mismo formato de documento) — estructuralmente
distinto al de la cuenta de cheques (`parsers/banamex.py`), aunque sea el
mismo banco.

Diferencias clave frente a la cuenta de cheques:

  - NO hay columna de saldo corriente por transacción, así que el truco de
    "delta de saldo" para inferir cargo/abono (ver banamex.py) no aplica
    aquí — hay que confiar en el signo que imprime el estado de cuenta.
  - Casi toda transacción es UNA sola línea (fecha compra, fecha aplicación,
    concepto, referencia, signo, monto) — **excepto** "PAGO INTERBANCARIO"
    (un pago SPEI recibido directo a la tarjeta), que sí es multi-línea:
    ver `PATRON_PAGO_INTERBANCARIO_INICIO`/`_CIERRE` más abajo, confirmado
    contra un estado de cuenta real (2026-09-20).
  - El año SÍ viene impreso en cada renglón (formato "DD-mon-AAAA", mes
    abreviado en minúsculas) — a diferencia de la cuenta de cheques, aquí
    no hace falta detectarlo aparte ni pedirlo por parámetro.

Estructura real (confirmada con datos anonimizados de un estado de cuenta
real): "DD-mon-AAAA DD-mon-AAAA CONCEPTO...REFERENCIA +$MONTO" — la primera
fecha es la fecha de compra, la segunda la fecha de aplicación al estado de
cuenta; usamos la de compra como fecha de la transacción.

CONVENCIÓN DE SIGNO: "+" en el PDF = cargo (una compra, aumenta lo que
debes) → monto_texto negativo. "-" en el PDF = abono (un pago, reduce lo
que debes) → monto_texto positivo. Confirmado contra un renglón "-" real
(2026-09-20, estado de cuenta TDC Beyond): una fila "SU ABONO...<texto> -
$X,XXX.XX" -- el signo "-" junto con la palabra "ABONO" en el concepto
corrobora la convención tal como está implementada.
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

# "DD-mon-AAAA DD-mon-AAAA CONCEPTO...REFERENCIA +$1,234.56" -- el final
# tolera puntos/espacios sueltos después del monto (`[\s.]*$` en vez de
# `\s*$`) porque en la última línea de la tabla de movimientos de una
# página, pdfplumber a veces concatena el monto con un ".." suelto que en
# el PDF real es un marcador de pie de página, sin salto de línea de por
# medio -- confirmado en un estado de cuenta real (2026-09-20): una línea
# terminaba en "... + $68.00 .." y por esos dos puntos de más el `$` al
# final no calzaba, así que la línea entera (fecha, concepto y monto, todo
# legible) se reportaba como "posible transacción no capturada" en vez de
# extraerse -- el monto en sí nunca estuvo en riesgo, solo el ancla final
# de la regex era demasiado estricta.
PATRON_TRANSACCION = re.compile(
    r"^(?P<fecha_compra>\d{2}-[a-zA-Z]{3}-\d{4})\s+"
    r"(?P<fecha_aplicacion>\d{2}-[a-zA-Z]{3}-\d{4})\s+"
    r"(?P<concepto>.+?)\s+"
    r"(?P<signo>[+-])\s*\$\s*(?P<monto>[\d,]+\.\d{2})[\s.]*$"
)

# Mismo prefijo que PATRON_TRANSACCION pero sin exigir el resto de la línea
# -- para detectar filas que SÍ son una transacción (traen las dos fechas)
# pero cuyo concepto/monto no se pudo leer como texto. Visto en un estado de
# cuenta real: una fila de "abono" (pago recibido) se imprime destacada y
# pdfplumber solo extrae las dos fechas, nada más -- el resto de esa fila
# es una imagen, no texto seleccionable. No hay forma de recuperar el monto
# desde extract_text() en ese caso; ver `advertencias()`.
PATRON_PREFIJO_FECHAS = re.compile(
    r"^\d{2}-[a-zA-Z]{3}-\d{4}\s+\d{2}-[a-zA-Z]{3}-\d{4}"
)

# La portada dice "Estado de Cuenta <Tipo>" (Platino, o a veces "Platinum"
# en inglés según la fuente del PDF; también existe Beyond, confirmado con
# un estado de cuenta real) -- en vez de depender de que esa línea aparezca
# exacta y sola (frágil ante variaciones de espaciado/salto de línea),
# buscamos cada palabra clave conocida en cualquier parte del texto de la
# página y normalizamos siempre al mismo alias, sin importar la grafía
# exacta que traiga el PDF real. Es una lista (orden = prioridad) para que
# agregar un tipo de tarjeta nuevo en el futuro sea una línea, no reescribir
# la lógica -- el mismo documento estructural (formato de transacción,
# convención de signo, etc.) sirve para cualquier tier de TDC Banamex, así
# que no hace falta una clase de parser separada por cada uno.
TIPOS_TARJETA_CONOCIDOS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"platino|platinum", re.IGNORECASE), "TDC Platino"),
    (re.compile(r"beyond", re.IGNORECASE), "TDC Beyond"),
    # "Conquista" es el nombre actual de un tier que antes se llamaba
    # "Prestige" (confirmado por el usuario, 2026-09-26) -- mismo caso que
    # "platino"/"platinum" arriba: dos grafías, un solo alias normalizado,
    # para no partir la cuenta en dos filas de `cuentas` si un estado de
    # cuenta viejo trae la grafía anterior.
    (re.compile(r"conquista|prestige", re.IGNORECASE), "TDC Conquista"),
]


def _detectar_tipo_tarjeta(texto_pagina: str) -> str | None:
    """Busca en `texto_pagina` cualquiera de los tipos de tarjeta conocidos
    y devuelve su alias normalizado, o None si ninguno aparece. Usado tanto
    por `extraer()` (para distinguir mensajes de cortesía específicos de un
    tier, ver `PATRON_ABONO_CORTESIA`) como por `extraer_info_cuenta()`
    (para el alias de la cuenta) -- una sola fuente de verdad para "qué
    tier de tarjeta es este documento"."""
    for patron_tipo, alias_normalizado in TIPOS_TARJETA_CONOCIDOS:
        if patron_tipo.search(texto_pagina):
            return alias_normalizado
    return None

# Respaldo si el PDF trae un tipo de tarjeta que no está en
# TIPOS_TARJETA_CONOCIDOS: portada "Estado de Cuenta <Tipo>" sola en su línea.
PATRON_ALIAS = re.compile(r"^Estado de Cuenta\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s*$")

# "Número de tarjeta: 0 0 0000000000000000" (u otra separación) — nos
# quedamos solo con los últimos 4 del run de dígitos más largo de la línea.
PATRON_LINEA_TARJETA = re.compile(r"n[uú]mero de tarjeta", re.IGNORECASE)

# "Pago mínimo" es específico de un estado de cuenta de TDC -- la cuenta de
# cheques no lo trae. Acepta con y sin acento por si pdfplumber no extrae
# bien el carácter según la fuente del PDF.
PATRON_PAGO_MINIMO = re.compile(r"pago\s+m[ií]nimo", re.IGNORECASE)

# Desde que se agregó parsers/invex_tdc.py (2026-09-21), "Pago mínimo" solo
# ya NO alcanza para identificar un TDC como de Banamex -- ambos emisores lo
# traen, así que un estado de cuenta de Invex también matcheaba aquí
# (confirmado con una prueba: los dos parsers devolvían True para el mismo
# PDF, lo que en `App._detectar_banco` degrada a selección manual para
# AMBOS en vez de acertar ninguno). No podemos volver a exigir "BANAMEX"
# como antes (ver el docstring del módulo: no aparece como texto
# seleccionable en un TDC real de Banamex), así que en vez de eso excluimos
# explícitamente cuando aparece "INVEX" -- funciona mientras el universo de
# emisores de TDC soportados sea chico; si se agrega un tercero que también
# comparta "Pago mínimo" sin nombre de banco seleccionable, este patrón de
# exclusión cruzada hay que repetirlo (o repensarlo) para cada par.
PATRON_INVEX = re.compile(r"invex", re.IGNORECASE)

# Un estado de cuenta con tarjetas adicionales agrupa las transacciones bajo
# encabezados "Tarjeta Titular: ...", "Tarjeta Adicional: ...", "Tarjeta
# Digital: ..." (confirmado contra un estado de cuenta real, 2026-09-20) --
# cada uno abre una sección nueva que sigue aplicando a los renglones
# siguientes hasta el próximo encabezado de este tipo. No nos importa qué
# viene después del tipo (número de tarjeta, nombre del titular) -- solo
# necesitamos saber en qué sección estamos.
PATRON_SECCION_TARJETA = re.compile(
    r"^Tarjeta\s+(Titular|Adicional|Digital)\b", re.IGNORECASE
)

# "PAGO INTERBANCARIO" (un SPEI recibido directo a la tarjeta) rompe el
# patrón de una-transacción-una-línea de todo el resto de este documento:
# imprime la fecha+concepto en su propia línea, SIN monto ni signo al final,
# seguido de varias líneas de detalle ("PAGO RECIBIDO DE:", "POR ORDEN DE:",
# "CLAVE DE RASTREO:", "CONCEPTO:") y cierra con una línea de "FECHA Y HORA
# DE LIQUIDACIÓN: ... REFERENCIA: <ref> <signo> $<monto>" que es donde SÍ
# vive el monto real. Confirmado contra un estado de cuenta real
# (2026-09-20) -- antes de esto, estas líneas generaban una advertencia de
# "posible transacción no capturada" porque el inicio del bloque matchea
# PATRON_PREFIJO_FECHAS pero no PATRON_TRANSACCION.
PATRON_PAGO_INTERBANCARIO_INICIO = re.compile(
    r"^(?P<fecha_compra>\d{2}-[a-zA-Z]{3}-\d{4})\s+"
    r"\d{2}-[a-zA-Z]{3}-\d{4}\s+"
    r"PAGO INTERBANCARIO\s*$",
    re.IGNORECASE,
)
PATRON_PAGO_INTERBANCARIO_CIERRE = re.compile(
    r"REFERENCIA:\s*\S+\s+(?P<signo>[+-])\s*\$\s*(?P<monto>[\d,]+\.\d{2})[\s.]*$",
    re.IGNORECASE,
)
PATRON_CONCEPTO = re.compile(r"^CONCEPTO:\s*(.+)$", re.IGNORECASE)

# Mensaje de cortesía genérico que imprime el banco tras un abono
# destacado ("SU ABONO...GRACIAS") -- no es un comercio real, es tu propio
# pago a la tarjeta. Pedido explícito del usuario (2026-09-20, extendido a
# cualquier tier el mismo día tras confirmarlo también en un estado Platino):
# en cualquier documento donde SÍ se detectó el tier (`tipo_tarjeta_documento`
# no es None), esta línea se reclasifica a categoria "PAGO TDC" / comercio
# "PAGO TDC <TIER>" (ej. "PAGO TDC BEYOND", "PAGO TDC PLATINO") en vez de
# quedar sin categorizar -- por eso `extraer()` le sustituye
# `descripcion_texto` por ese literal, derivado de `tipo_tarjeta_documento`
# (`TIPOS_TARJETA_CONOCIDOS` ya lo normaliza a "TDC <Tier>"). Si el tier no
# se pudo detectar en absoluto, la línea se deja tal cual el PDF la imprime,
# sin categorizar. El texto real sigue intacto en `linea_cruda` para
# auditoría. Cada tier necesita su propia regla en
# `reglas_categorizacion.json` (`"PAGO TDC BEYOND"`, `"PAGO TDC PLATINO"`,
# etc.) ya que `categorizar()` solo matchea texto exacto -- agregar un tier
# nuevo a `TIPOS_TARJETA_CONOCIDOS` no crea su regla de categorización sola.
PATRON_ABONO_CORTESIA = re.compile(r"^SU ABONO\.\.\.", re.IGNORECASE)


def _a_decimal(texto: str) -> Decimal:
    return Decimal(texto.replace(",", ""))


class BanamexTdcParser(BaseParser):
    nombre_banco = "Banamex TDC"

    def __init__(self) -> None:
        self._advertencias: list[str] = []

    def extraer(self, ruta_pdf: Path) -> list[RenglonCrudo]:
        renglones: list[RenglonCrudo] = []
        self._advertencias = []
        # Estado del documento completo, no por página -- una sección de
        # tarjeta (o un bloque de PAGO INTERBANCARIO sin cerrar) puede
        # seguir vigente a través de un salto de página, igual que
        # cualquier otro bloque en este extractor.
        tarjeta_actual: str | None = None
        bloque_interbancario: dict | None = None
        # Tier del documento completo (Platino/Beyond/...), no por página --
        # se detecta una sola vez con la primera página que lo mencione y
        # ya no cambia. Solo se usa para PATRON_ABONO_CORTESIA por ahora.
        tipo_tarjeta_documento: str | None = None

        def abandonar_bloque_interbancario(motivo: str) -> None:
            nonlocal bloque_interbancario
            assert bloque_interbancario is not None
            self._advertencias.append(
                f"Página {bloque_interbancario['pagina']}: bloque de PAGO "
                f"INTERBANCARIO sin cerrar ({motivo}) -- revísalo a mano: "
                f"{' | '.join(bloque_interbancario['lineas_crudas'])!r}"
            )
            bloque_interbancario = None

        with pdfplumber.open(ruta_pdf) as pdf:
            for numero_pagina, pagina in enumerate(pdf.pages, start=1):
                texto = pagina.extract_text() or ""

                if tipo_tarjeta_documento is None:
                    tipo_tarjeta_documento = _detectar_tipo_tarjeta(texto)

                for linea in texto.splitlines():
                    linea = linea.strip()
                    if not linea:
                        continue

                    coincidencia_seccion = PATRON_SECCION_TARJETA.match(linea)
                    if coincidencia_seccion:
                        if bloque_interbancario is not None:
                            abandonar_bloque_interbancario("nueva sección de tarjeta")
                        tarjeta_actual = coincidencia_seccion.group(1).capitalize()
                        continue

                    if bloque_interbancario is not None:
                        coincidencia_cierre = PATRON_PAGO_INTERBANCARIO_CIERRE.search(linea)
                        if coincidencia_cierre:
                            try:
                                monto = _a_decimal(coincidencia_cierre.group("monto"))
                            except InvalidOperation:
                                abandonar_bloque_interbancario("monto ilegible")
                                continue
                            signo_pdf = coincidencia_cierre.group("signo")
                            # Ver convención de signo en el docstring del módulo.
                            monto_texto = f"-{monto}" if signo_pdf == "+" else str(monto)
                            concepto = bloque_interbancario["concepto"]
                            descripcion_texto = (
                                f"PAGO RECIBIDO {concepto}".strip()
                                if concepto
                                else "PAGO RECIBIDO"
                            )
                            bloque_interbancario["lineas_crudas"].append(linea)
                            renglones.append(
                                RenglonCrudo(
                                    fecha_texto=bloque_interbancario["fecha_texto"],
                                    descripcion_texto=descripcion_texto,
                                    monto_texto=monto_texto,
                                    pagina=bloque_interbancario["pagina"],
                                    linea_cruda=" | ".join(
                                        bloque_interbancario["lineas_crudas"]
                                    ),
                                    tarjeta=tarjeta_actual,
                                )
                            )
                            bloque_interbancario = None
                            continue

                        # ¿Esta línea es en realidad el inicio de OTRA
                        # transacción? Entonces el bloque anterior nunca
                        # cerró (formato inesperado) -- lo abandonamos con
                        # aviso y dejamos que el flujo normal de abajo
                        # procese esta línea, en vez de tragársela como
                        # detalle del bloque viejo.
                        if PATRON_PAGO_INTERBANCARIO_INICIO.match(
                            linea
                        ) or PATRON_TRANSACCION.match(linea):
                            abandonar_bloque_interbancario("formato inesperado")
                        else:
                            bloque_interbancario["lineas_crudas"].append(linea)
                            if bloque_interbancario["concepto"] is None:
                                coincidencia_concepto = PATRON_CONCEPTO.match(linea)
                                if coincidencia_concepto:
                                    bloque_interbancario["concepto"] = (
                                        coincidencia_concepto.group(1).strip()
                                    )
                            continue

                    coincidencia_inicio_interbancario = (
                        PATRON_PAGO_INTERBANCARIO_INICIO.match(linea)
                    )
                    if coincidencia_inicio_interbancario:
                        fecha_texto = self._normalizar_fecha(
                            coincidencia_inicio_interbancario.group("fecha_compra")
                        )
                        if fecha_texto is not None:
                            bloque_interbancario = {
                                "pagina": numero_pagina,
                                "fecha_texto": fecha_texto,
                                "concepto": None,
                                "lineas_crudas": [linea],
                            }
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

                    fecha_texto = self._normalizar_fecha(coincidencia.group("fecha_compra"))
                    if fecha_texto is None:
                        continue

                    descripcion_texto = coincidencia.group("concepto").strip()
                    if (
                        tipo_tarjeta_documento is not None
                        and PATRON_ABONO_CORTESIA.match(descripcion_texto)
                    ):
                        # "TDC Beyond" -> "BEYOND", "TDC Platino" -> "PLATINO", etc.
                        tier = tipo_tarjeta_documento.removeprefix("TDC ").upper()
                        descripcion_texto = f"PAGO TDC {tier}"

                    renglones.append(
                        RenglonCrudo(
                            fecha_texto=fecha_texto,
                            descripcion_texto=descripcion_texto,
                            monto_texto=monto_texto,
                            pagina=numero_pagina,
                            linea_cruda=linea,
                            tarjeta=tarjeta_actual,
                        )
                    )

        if bloque_interbancario is not None:
            abandonar_bloque_interbancario("fin del documento")

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
        alias: str | None = None
        ultimos_4: str | None = None

        with pdfplumber.open(ruta_pdf) as pdf:
            for pagina in pdf.pages[:3]:
                texto = pagina.extract_text() or ""

                if alias is None:
                    alias = _detectar_tipo_tarjeta(texto)

                for linea in texto.splitlines():
                    linea = linea.strip()

                    if alias is None:
                        coincidencia = PATRON_ALIAS.match(linea)
                        if coincidencia:
                            alias = f"TDC {coincidencia.group(1)}"

                    if ultimos_4 is None and PATRON_LINEA_TARJETA.search(linea):
                        digitos = re.findall(r"\d+", linea)
                        if digitos:
                            numero_completo = max(digitos, key=len)
                            if len(numero_completo) >= 4:
                                ultimos_4 = numero_completo[-4:]
                            # numero_completo no se guarda en ningún otro
                            # lado ni se propaga fuera de este bloque.

                if alias is not None and ultimos_4 is not None:
                    return alias, ultimos_4

        return alias, ultimos_4

    def puede_procesar(self, ruta_pdf: Path) -> bool:
        # OJO: "Número de tarjeta" NO sirve como marcador -- la cuenta de
        # cheques también trae uno ("Número de Tarjeta de Débito", ver
        # banamex.py). Tampoco condicionamos a que además diga "BANAMEX" en
        # texto plano: el logo de portada es una imagen, y en un estado de
        # cuenta real de TDC "BANAMEX" no aparece como texto seleccionable
        # en ninguna de las primeras páginas (a diferencia de la cuenta de
        # cheques, que sí lo trae en conceptos como "CREDITO NOMINA
        # BANAMEX") -- exigirlo aquí causaba que la detección automática
        # nunca disparara. "Pago mínimo" por sí solo ya es exclusivo de un
        # estado de cuenta de tarjeta de crédito (la cuenta de cheques no lo
        # trae), así que basta como único marcador.
        try:
            with pdfplumber.open(ruta_pdf) as pdf:
                texto_acumulado = "\n".join(
                    pagina.extract_text() or "" for pagina in pdf.pages[:2]
                )
        except Exception:  # noqa: BLE001 — un PDF ilegible simplemente no matchea
            return False
        return bool(
            PATRON_PAGO_MINIMO.search(texto_acumulado)
            and not PATRON_INVEX.search(texto_acumulado)
        )
