"""Categoriza transacciones por reglas de palabra clave sobre la descripción.

Las reglas son datos, no código: viven en un JSON editable (por defecto
`transform/reglas_categorizacion.json`, ignorado por git por ser información
personal — de dónde gastas — igual que los PDFs). La app de escritorio las
lee/escribe con las funciones de este módulo; también se pueden editar el
JSON a mano.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

RUTA_REGLAS_POR_DEFECTO = Path(__file__).parent / "reglas_categorizacion.json"


@dataclass(frozen=True)
class Regla:
    """Si `patron` aparece en la descripción (sin importar mayúsculas), se
    asigna `categoria`. Primera regla que matchea gana — el orden importa."""

    patron: str
    categoria: str


def cargar_reglas(ruta: Path = RUTA_REGLAS_POR_DEFECTO) -> list[Regla]:
    if not ruta.exists():
        return []

    datos = json.loads(ruta.read_text(encoding="utf-8"))
    return [Regla(**r) for r in datos]


def guardar_reglas(reglas: list[Regla], ruta: Path = RUTA_REGLAS_POR_DEFECTO) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    datos = [asdict(r) for r in reglas]
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


def categorizar(descripcion: str, reglas: list[Regla]) -> str | None:
    """Devuelve la categoría de la primera regla cuyo patrón aparece en la
    descripción (comparación insensible a mayúsculas), o None si ninguna aplica."""
    descripcion_normalizada = descripcion.upper()
    for regla in reglas:
        if regla.patron.upper() in descripcion_normalizada:
            return regla.categoria
    return None
