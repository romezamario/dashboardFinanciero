"""Extractor para estados de cuenta de débito BBVA México (ej. Tarjeta Nómina).

Formato (confirmado con un estado de cuenta real anonimizado, 2026-11-20):
la tabla "Detalle de Movimientos" tiene las columnas

    FECHA OPER | FECHA LIQ | DESCRIPCION | REFERENCIA | CARGOS | ABONOS |
    SALDO OPERACION | SALDO LIQUIDACION

y `extract_text()` la entrega como texto plano, una línea por movimiento:

    "05/OCT 05/OCT SPEI ENVIADO BANORTE 500.00 12,345.67 12,345.67"

seguida de 0..N líneas de detalle sin fecha (referencia, clave de rastreo,
CLABE/cuenta destino, nombre del beneficiario) que se suman a la descripción.
Las fechas son "DD/MES" (sin año): el año sale del "Periodo DEL dd/mm/aaaa AL
dd/mm/aaaa" de la portada, y si el periodo cruza de diciembre a enero cada
movimiento toma el año que le toca según su mes.

CARGO O ABONO: el texto no dice en qué columna (CARGOS o ABONOS) cayó el
monto, así que, igual que `banamex.py`, el signo sale del DELTA DEL SALDO
(saldo de operación). En el ejemplo real todas las filas traen saldo, pero
BBVA a veces lo imprime solo en el último movimiento del día: en ese caso los
movimientos sin saldo se juntan hasta la siguiente fila con saldo y se busca
la única combinación de signos que explica el cambio de saldo. Si hay más de
una (o ninguna), se usa una pista por palabras ("RECIBIDO", "DEPOSITO"...) y
se avisa en `advertencias()` para revisarlo a mano. Al final se compara contra
"TOTAL IMPORTE CARGOS/ABONOS" del propio estado de cuenta y se avisa si no
cuadra.
"""

from __future__ import annotations

import itertools
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pdfplumber

from parsers.base import BaseParser, RenglonCrudo, SugerenciaRenglonManual
from parsers.comun import MESES, textos_iniciales

MONTO = r"-?[\d,]+\.\d{2}"

# "05/OCT 06/OCT <resto>" — fecha de operación y de liquidación.
PATRON_MOVIMIENTO = re.compile(
    r"^(\d{2})/([A-Za-z]{3})\s+\d{2}/[A-Za-z]{3}\s+(.*)$"
)
# Final de la fila: monto [saldo operación [saldo liquidación]].
PATRON_MONTOS = re.compile(
    rf"^(?P<desc>.*?)\s*(?P<monto>{MONTO})(?:\s+(?P<saldo>{MONTO}))?(?:\s+(?P<liq>{MONTO}))?\s*$"
)
PATRON_PERIODO = re.compile(
    r"Periodo\s+DEL\s+\d{2}/(\d{2})/(\d{4})\s+AL\s+\d{2}/(\d{2})/(\d{4})", re.IGNORECASE
)
PATRON_SALDO_ANTERIOR = re.compile(rf"Saldo\s+Anterior\s+({MONTO})", re.IGNORECASE)
PATRON_TOTAL = re.compile(rf"TOTAL\s+IMPORTE\s+(CARGOS|ABONOS)\s+({MONTO})", re.IGNORECASE)
PATRON_CUENTA = re.compile(r"No\.\s*de\s+Cuenta\s+(\d{4,})", re.IGNORECASE)
PATRON_ENCABEZADO_TABLA = re.compile(r"DESCRIPCION\s+REFERENCIA\s+CARGOS\s+ABONOS", re.IGNORECASE)
PATRON_FIN_TABLA = re.compile(r"^Total\s+de\s+Movimientos", re.IGNORECASE)

# Encabezados/pies que se repiten en cada página: nunca son detalle de un
# movimiento (un movimiento puede seguir en la página siguiente).
PATRON_RUIDO = re.compile(
    r"^(Estado de Cuenta$|TARJETA\b|P[ÁA]GINA\s+\d|No\.\s*de\s+(Cuenta|Cliente)|"
    r"BBVA MEXICO, S\.A\.|BBVA MEXICO,|Av\.\s|La GAT\b|FECHA\s+SALDO|OPER\s+LIQ\b)",
    re.IGNORECASE,
)

# Pista de "es un abono" cuando el saldo no alcanza a decidir el signo.
PATRON_PISTA_ABONO = re.compile(
    r"RECIBIDO|DEPOSITO|DEPÓSITO|ABONO|NOMINA|NÓMINA|DEVOLUCION|DEVOLUCIÓN|"
    r"INTERESES|REEMBOLSO|BONIFICACION",
    re.IGNORECASE,
)

# Más movimientos que esto sin saldo entre medio = no se prueban combinaciones
# (2^n); se usa la pista y se avisa.
MAXIMO_COMBINACIONES = 14


def _a_decimal(texto: str) -> Decimal:
    return Decimal(texto.replace(",", ""))


class BbvaDebitoParser(BaseParser):
    nombre_banco = "BBVA"

    def __init__(self, ano_estado_de_cuenta: str = "2025") -> None:
        self.ano_estado_de_cuenta = ano_estado_de_cuenta
        # (mes inicial, año inicial, mes final, año final) del periodo.
        self._periodo: tuple[int, str, int, str] | None = None
        self._advertencias: list[str] = []
        self._sugerencias: list[SugerenciaRenglonManual] = []

    def advertencias(self) -> list[str]:
        return list(self._advertencias)

    def sugerencias_renglon_manual(self) -> list[SugerenciaRenglonManual]:
        return list(self._sugerencias)

    # -- detección y cuenta -------------------------------------------------

    def puede_procesar(self, ruta_pdf: Path) -> bool:
        # "BBVA" solo no basta (BBVA también emite tarjetas de crédito): se
        # exige además el encabezado de la tabla de movimientos de débito.
        try:
            for texto in textos_iniciales(ruta_pdf, 3):
                if "BBVA" in texto.upper() and PATRON_ENCABEZADO_TABLA.search(texto):
                    return True
        except Exception:  # noqa: BLE001 — un PDF ilegible simplemente no matchea
            return False
        return False

    def extraer_info_cuenta(self, ruta_pdf: Path) -> tuple[str | None, str | None]:
        textos = textos_iniciales(ruta_pdf, 1)
        if not textos:
            return None, None
        texto = textos[0]
        alias = "BBVA Nómina" if re.search(r"N[ÓO]MINA", texto, re.IGNORECASE) else "BBVA Débito"
        ultimos_4 = None
        coincidencia = PATRON_CUENTA.search(texto)
        if coincidencia:
            ultimos_4 = coincidencia.group(1)[-4:]
            # el número completo no se guarda en ningún otro lado
        return alias, ultimos_4

    # -- extracción ---------------------------------------------------------

    def extraer(self, ruta_pdf: Path) -> list[RenglonCrudo]:
        lineas: list[tuple[int, str]] = []
        with pdfplumber.open(ruta_pdf) as pdf:
            for numero, pagina in enumerate(pdf.pages, start=1):
                for linea in (pagina.extract_text() or "").splitlines():
                    linea = linea.strip()
                    if linea:
                        lineas.append((numero, linea))
        return self._procesar_documento(lineas)

    def _anio_de(self, mes: int) -> str:
        if self._periodo is None:
            return self.ano_estado_de_cuenta
        mes_ini, anio_ini, _mes_fin, anio_fin = self._periodo
        if anio_ini != anio_fin and mes >= mes_ini:
            return anio_ini
        return anio_fin

    def _procesar_documento(self, lineas: list[tuple[int, str]]) -> list[RenglonCrudo]:
        self._advertencias = []
        self._sugerencias = []
        self._periodo = None

        saldo: Decimal | None = None
        totales: dict[str, Decimal] = {}
        # Cada movimiento: dict con fecha, pagina, desc (lista), crudas (lista),
        # monto (Decimal) y saldo (Decimal | None).
        movimientos: list[dict] = []
        actual: dict | None = None
        en_tabla = False

        for pagina, linea in lineas:
            if self._periodo is None and (m := PATRON_PERIODO.search(linea)):
                self._periodo = (int(m.group(1)), m.group(2), int(m.group(3)), m.group(4))
                self.ano_estado_de_cuenta = m.group(4)
            if saldo is None and not movimientos and (m := PATRON_SALDO_ANTERIOR.search(linea)):
                saldo = _a_decimal(m.group(1))
            if m := PATRON_TOTAL.search(linea):
                totales[m.group(1).upper()] = _a_decimal(m.group(2))
            if PATRON_FIN_TABLA.match(linea):
                en_tabla = False
                actual = None
                continue

            mov = PATRON_MOVIMIENTO.match(linea)
            if mov:
                en_tabla = True
                dia, mes_txt, resto = mov.groups()
                mes = MESES.get(mes_txt.lower())
                montos = PATRON_MONTOS.match(resto)
                if mes is None or montos is None:
                    actual = None
                    fecha = f"{dia}/{mes}/{self._anio_de(int(mes))}" if mes else None
                    self._advertir(pagina, fecha, "un movimiento sin monto legible", linea)
                    continue
                actual = {
                    "fecha": f"{dia}/{mes}/{self._anio_de(int(mes))}",
                    "pagina": pagina,
                    "desc": [montos.group("desc").strip()],
                    "crudas": [linea],
                    "monto": _a_decimal(montos.group("monto")),
                    "saldo": _a_decimal(montos.group("saldo")) if montos.group("saldo") else None,
                }
                movimientos.append(actual)
                continue

            if en_tabla and actual is not None and not PATRON_RUIDO.match(linea):
                actual["desc"].append(linea)
                actual["crudas"].append(linea)

        signos = self._resolver_signos(movimientos, saldo)

        renglones: list[RenglonCrudo] = []
        suma = {"CARGOS": Decimal("0"), "ABONOS": Decimal("0")}
        for mov, signo in zip(movimientos, signos):
            suma["ABONOS" if signo > 0 else "CARGOS"] += mov["monto"]
            monto = mov["monto"] if signo > 0 else -mov["monto"]
            renglones.append(
                RenglonCrudo(
                    fecha_texto=mov["fecha"],
                    descripcion_texto=" ".join(d for d in mov["desc"] if d),
                    monto_texto=str(monto),
                    pagina=mov["pagina"],
                    linea_cruda=" | ".join(mov["crudas"]),
                )
            )

        for clave, total in totales.items():
            if suma[clave] != total:
                self._advertencias.append(
                    f"Los {clave.lower()} leídos suman {suma[clave]:,.2f} pero el estado de "
                    f"cuenta dice {total:,.2f}: revisa si falta un movimiento o si alguno "
                    "quedó con el signo al revés."
                )
        return renglones

    def _advertir(self, pagina: int, fecha: str | None, motivo: str, texto: str) -> None:
        self._advertencias.append(f"Página {pagina}: {motivo} -- {texto[:120]}")
        self._sugerencias.append(SugerenciaRenglonManual(fecha_texto=fecha, pagina=pagina))

    def _resolver_signos(self, movimientos: list[dict], saldo: Decimal | None) -> list[int]:
        """+1 = abono, -1 = cargo, uno por movimiento (ver docstring del módulo)."""
        signos: list[int] = []
        grupo: list[dict] = []

        def pista(mov: dict) -> int:
            return 1 if PATRON_PISTA_ABONO.search(" ".join(mov["desc"])) else -1

        def cerrar(saldo_nuevo: Decimal | None) -> None:
            nonlocal grupo
            sugeridos = [pista(m) for m in grupo]
            elegidos = sugeridos
            if saldo is not None and saldo_nuevo is not None:
                delta = saldo_nuevo - saldo
                validos = []
                if len(grupo) <= MAXIMO_COMBINACIONES:
                    validos = [
                        combo
                        for combo in itertools.product((1, -1), repeat=len(grupo))
                        if sum(s * m["monto"] for s, m in zip(combo, grupo)) == delta
                    ]
                if len(validos) == 1:
                    elegidos = list(validos[0])
                elif validos:
                    elegidos = list(
                        max(validos, key=lambda c: sum(a == b for a, b in zip(c, sugeridos)))
                    )
                    for m, s, sug in zip(grupo, elegidos, sugeridos):
                        self._advertir(
                            m["pagina"], m["fecha"],
                            "no se pudo saber con certeza si es cargo o abono "
                            f"(quedó como {'abono' if s > 0 else 'cargo'})",
                            " ".join(m["desc"]),
                        )
                else:
                    for m in grupo:
                        self._advertir(
                            m["pagina"], m["fecha"],
                            "el saldo no cuadra con los montos leídos; revisa este movimiento",
                            " ".join(m["desc"]),
                        )
            else:
                for m in grupo:
                    self._advertir(
                        m["pagina"], m["fecha"],
                        "sin saldo para confirmar si es cargo o abono "
                        f"(quedó como {'abono' if pista(m) > 0 else 'cargo'})",
                        " ".join(m["desc"]),
                    )
            signos.extend(elegidos)
            grupo = []

        for mov in movimientos:
            grupo.append(mov)
            if mov["saldo"] is not None:
                cerrar(mov["saldo"])
                saldo = mov["saldo"]
        if grupo:
            cerrar(None)
        return signos
