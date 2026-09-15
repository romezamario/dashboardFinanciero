"""Genera app/icono.ico (un ícono simple, placeholder) para el ejecutable.

No forma parte del pipeline — es una utilidad de una sola vez para producir
el ícono que usa DashboardFinanciero.spec al empaquetar la app. Vuelve a
correrla si quieres cambiar el diseño (colores/forma) o si el .ico se
pierde/corrompe.

Requiere Pillow (ya viene como dependencia transitiva de pdfplumber, o
instálalo aparte con `pip install pillow` si haces esto fuera del venv del
proyecto).

Uso:
    python -m app.generar_icono
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

RUTA_SALIDA = Path(__file__).parent / "icono.ico"


def generar() -> None:
    tamano = 256
    img = Image.new("RGBA", (tamano, tamano), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margen = 8
    draw.ellipse(
        [margen, margen, tamano - margen, tamano - margen],
        fill=(21, 128, 61, 255),
        outline=(255, 255, 255, 255),
        width=6,
    )

    base_y = 190
    barras = [
        (70, base_y, 100, 150),
        (115, base_y, 145, 120),
        (160, base_y, 190, 80),
    ]
    for x0, y0, x1, y1 in barras:
        draw.rectangle([x0, y1, x1, y0], fill=(255, 255, 255, 255))

    img.save(
        RUTA_SALIDA,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"Ícono guardado en {RUTA_SALIDA}")


if __name__ == "__main__":
    generar()
