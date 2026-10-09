"""Piezas que comparten los extractores (antes copiadas en cada uno)."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import pdfplumber

# Mes abreviado en español -> número. Las llaves van en minúsculas: quien
# busca normaliza con `.lower()` ("ENE" en cheques, "ene"/"Ene" en TDC).
# A propósito no se usa `strptime("%b")`: depende del locale del sistema.
MESES = {
    "ene": "01", "feb": "02", "mar": "03", "abr": "04",
    "may": "05", "jun": "06", "jul": "07", "ago": "08",
    "sep": "09", "oct": "10", "nov": "11", "dic": "12",
}

# "Pago mínimo" solo existe en estados de cuenta de tarjeta de crédito;
# "INVEX" distingue a Invex de Banamex TDC (ver `puede_procesar` de cada uno).
PATRON_PAGO_MINIMO = re.compile(r"pago\s+m[ií]nimo", re.IGNORECASE)
PATRON_INVEX = re.compile(r"invex", re.IGNORECASE)

# Páginas del inicio que miran la detección automática (`puede_procesar`) y
# la lectura de la cuenta (`extraer_info_cuenta`).
PAGINAS_INICIALES = 3


@lru_cache(maxsize=1)
def _textos_iniciales(ruta: str, modificado_ns: int, tamano: int) -> tuple[str, ...]:
    with pdfplumber.open(ruta) as pdf:
        return tuple(pagina.extract_text() or "" for pagina in pdf.pages[:PAGINAS_INICIALES])


def textos_iniciales(ruta_pdf: Path, paginas: int = PAGINAS_INICIALES) -> tuple[str, ...]:
    """Texto de las primeras `paginas` páginas del PDF (máximo
    `PAGINAS_INICIALES`). Al cargar un PDF, la detección del banco prueba
    cada extractor y luego se leen la cuenta y el tipo de tarjeta: antes cada
    paso abría el PDF y volvía a extraer el texto de las mismas páginas (5-6
    veces por carga). Ahora se extrae una vez y se reusa; la llave incluye
    fecha de modificación y tamaño, así que un archivo cambiado se vuelve a
    leer.

    Ese texto puede traer el número de cuenta completo: la app llama a
    `olvidar_textos_iniciales()` al terminar cada carga para no dejarlo en
    memoria (los extractores solo conservan los últimos 4 dígitos)."""
    datos = ruta_pdf.stat()
    return _textos_iniciales(str(ruta_pdf), datos.st_mtime_ns, datos.st_size)[:paginas]


def olvidar_textos_iniciales() -> None:
    _textos_iniciales.cache_clear()
