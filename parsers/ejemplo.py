"""Extractor de EJEMPLO — plantilla para copiar por cada banco real.

`Ejemplo` no es un banco real: existe para documentar el patrón que debe
seguir cada extractor concreto. Para agregar un banco nuevo:

1. Copia este archivo a `parsers/<banco>.py` (ej. `parsers/bbva.py`).
2. Cambia `nombre_banco`.
3. Abre un PDF real de ese banco con pdfplumber (`pagina.extract_text()`) y
   mira línea por línea cómo se ve una transacción — cada banco tiene un
   layout distinto (orden de columnas, separadores, si el monto trae signo
   o una columna de cargo/abono separada, etc.).
4. Ajusta `PATRON_RENGLON` (o reemplaza la lógica de `extraer` por completo
   si el formato no es una sola línea por transacción) hasta que capture
   exactamente las líneas de transacción y nada más.

El resto del pipeline (Transformador, Categorizador, Sincronizador) no sabe
nada de bancos — con que `extraer` devuelva `RenglonCrudo`s correctos, todo
lo demás funciona igual sin importar cuál banco sea.
"""

from __future__ import annotations

import re
from pathlib import Path

import pdfplumber

from parsers.base import BaseParser, RenglonCrudo

# Ejemplo de líneas que este patrón reconoce:
#   "01/09/2026 PAGO NETFLIX MX                    -199.00"   (cargo)
#   "03/09/2026 DEPOSITO SPEI JUAN PEREZ           1,500.00"  (abono)
# Grupos: fecha (dd/mm/aaaa), descripción (lo de en medio), monto (##.##,
# con separador de miles opcional, signo opcional). Esto es solo un ejemplo
# razonable — el formato real de tu banco casi seguro es distinto. Si tu
# banco no imprime el signo (ej. columnas separadas de "Cargo"/"Abono"),
# es este extractor el que debe anteponer el "-" al armar monto_texto —
# ver la nota en parsers/base.py sobre la convención de signo.
PATRON_RENGLON = re.compile(
    r"^(?P<fecha>\d{2}/\d{2}/\d{4})\s+"
    r"(?P<descripcion>.+?)\s+"
    r"(?P<monto>-?[\d,]+\.\d{2})$"
)


class EjemploParser(BaseParser):
    """Plantilla documentada — no es un banco real."""

    nombre_banco = "Ejemplo"

    def extraer(self, ruta_pdf: Path) -> list[RenglonCrudo]:
        renglones: list[RenglonCrudo] = []

        with pdfplumber.open(ruta_pdf) as pdf:
            for numero_pagina, pagina in enumerate(pdf.pages, start=1):
                texto = pagina.extract_text() or ""
                for linea in texto.splitlines():
                    linea = linea.strip()
                    if not linea:
                        continue

                    match = PATRON_RENGLON.match(linea)
                    if not match:
                        # Encabezados, totales, saldos, pies de página, etc.
                        continue

                    renglones.append(
                        RenglonCrudo(
                            fecha_texto=match.group("fecha"),
                            descripcion_texto=match.group("descripcion").strip(),
                            monto_texto=match.group("monto"),
                            pagina=numero_pagina,
                            linea_cruda=linea,
                        )
                    )

        return renglones
