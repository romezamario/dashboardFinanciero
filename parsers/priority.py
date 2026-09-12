"""Extractor para estados de cuenta con tabla de columnas
FECHA | CONCEPTO | RETIROS | DEPOSITOS | SALDO, donde el concepto de una
transacción se envuelve en varias líneas (cada línea de continuación no
trae fecha ni monto — pertenece a la transacción anterior).

Ejemplo (datos inventados, mismo layout) de cómo se ve una fila real:

    FECHA    CONCEPTO                           RETIROS    DEPOSITOS   SALDO
    02 JUN   PAGO RECIBIDO DE ALGUN BANCO
             POR ORDEN DE FULANO PEREZ
                                                             1,000.00   5,000.00
    04 JUN   COMPRA EN TIENDA XYZ
                                                   200.00                4,800.00

A diferencia de parsers/ejemplo.py, un regex de una sola línea no alcanza:
el monto (retiro o depósito) y el saldo aparecen en la ÚLTIMA línea del
bloque de concepto, y para saber si un número es retiro o depósito hace
falta su columna, no solo su texto — dos números con el mismo formato caen
en columnas distintas. Por eso este extractor usa `pagina.extract_tables()`
(que respeta las líneas de la tabla dibujadas en el PDF) en vez de
`extract_text()`.

IMPORTANTE — el año: el PDF no imprime el año en cada renglón, solo
"DD MES" (ej. "02 JUN"). Ajusta `ano_estado_de_cuenta` al año real antes de
procesar un PDF (ej. tomándolo del nombre del archivo o del periodo impreso
en el encabezado del estado de cuenta).
"""

from __future__ import annotations

import re
from pathlib import Path

import pdfplumber

from parsers.base import BaseParser, RenglonCrudo

MESES = {
    "ENE": "01", "FEB": "02", "MAR": "03", "ABR": "04",
    "MAY": "05", "JUN": "06", "JUL": "07", "AGO": "08",
    "SEP": "09", "OCT": "10", "NOV": "11", "DIC": "12",
}

PATRON_FECHA = re.compile(r"^(\d{2})\s+([A-ZÁÉÍÓÚ]{3})\.?$")
PATRON_MONTO = re.compile(r"^-?[\d,]+\.\d{2}$")


class PriorityParser(BaseParser):
    """Nombre de archivo de ejemplo: "2025 Junio Priority.pdf". Ajusta
    `nombre_banco` si "Priority" no es el banco sino un nivel de cuenta."""

    nombre_banco = "Priority"

    def __init__(self, ano_estado_de_cuenta: str = "2025") -> None:
        # El PDF no trae el año en cada renglón — ver docstring del módulo.
        self.ano_estado_de_cuenta = ano_estado_de_cuenta

    def extraer(self, ruta_pdf: Path) -> list[RenglonCrudo]:
        renglones: list[RenglonCrudo] = []

        with pdfplumber.open(ruta_pdf) as pdf:
            for numero_pagina, pagina in enumerate(pdf.pages, start=1):
                for tabla in pagina.extract_tables():
                    renglones.extend(self._procesar_tabla(tabla, numero_pagina))

        return renglones

    def _procesar_tabla(
        self, tabla: list[list[str | None]], numero_pagina: int
    ) -> list[RenglonCrudo]:
        renglones: list[RenglonCrudo] = []
        bloque_fecha: str | None = None
        bloque_concepto: list[str] = []
        bloque_lineas_crudas: list[str] = []

        def cerrar_bloque(retiro: str | None, deposito: str | None) -> None:
            nonlocal bloque_fecha, bloque_concepto, bloque_lineas_crudas
            if bloque_fecha is not None and (retiro or deposito):
                monto_texto = f"-{retiro}" if retiro else deposito
                renglones.append(
                    RenglonCrudo(
                        fecha_texto=f"{bloque_fecha}{self.ano_estado_de_cuenta}",
                        descripcion_texto=" ".join(bloque_concepto).strip(),
                        monto_texto=monto_texto or "",
                        pagina=numero_pagina,
                        linea_cruda=" | ".join(bloque_lineas_crudas),
                    )
                )
            bloque_fecha = None
            bloque_concepto = []
            bloque_lineas_crudas = []

        for fila in tabla:
            celdas = [(c or "").strip() for c in fila]
            if len(celdas) < 5:
                continue
            fecha, concepto, retiros, depositos, _saldo = celdas[:5]

            match_fecha = PATRON_FECHA.match(fecha)
            if match_fecha:
                # Nueva transacción — cierra el bloque anterior si nunca tuvo
                # monto (ej. "SALDO ANTERIOR": no es una transacción real).
                cerrar_bloque(None, None)
                dia, mes_abrev = match_fecha.groups()
                mes = MESES.get(mes_abrev, "01")
                bloque_fecha = f"{dia}/{mes}/"

            if concepto:
                bloque_concepto.append(concepto)
            bloque_lineas_crudas.append(" ".join(c for c in celdas if c))

            retiro_valido = retiros if PATRON_MONTO.match(retiros) else None
            deposito_valido = depositos if PATRON_MONTO.match(depositos) else None
            if retiro_valido or deposito_valido:
                cerrar_bloque(retiro_valido, deposito_valido)

        return renglones
