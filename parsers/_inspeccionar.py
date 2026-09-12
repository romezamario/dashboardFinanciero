"""Herramienta de desarrollo: imprime línea por línea el texto que pdfplumber
extrae de un PDF, para diseñar o ajustar el PATRON_RENGLON de un extractor.

No normaliza, no sincroniza, no guarda nada — solo te deja ver cómo
pdfplumber "lee" el PDF, para que puedas comparar contra el regex del
extractor que estés escribiendo. El PDF no sale de tu laptop.

Uso:
    python -m parsers._inspeccionar ruta/al/estado_de_cuenta.pdf
"""

from __future__ import annotations

import sys
from pathlib import Path

import pdfplumber


def main() -> None:
    if len(sys.argv) != 2:
        print("Uso: python -m parsers._inspeccionar ruta/al/archivo.pdf")
        sys.exit(1)

    ruta = Path(sys.argv[1])
    with pdfplumber.open(ruta) as pdf:
        for numero, pagina in enumerate(pdf.pages, start=1):
            print(f"\n--- Página {numero} ---")
            texto = pagina.extract_text() or "(sin texto extraíble en esta página)"
            for i, linea in enumerate(texto.splitlines()):
                # repr() para que espacios/tabs raros no se escondan a simple vista
                print(f"{i:3} | {linea!r}")


if __name__ == "__main__":
    main()
