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
    asigna `categoria` y, si se definió, `comercio`. Primera regla que
    matchea gana — el orden importa.

    `comercio` es opcional (default None) a propósito: las reglas ya
    existentes en `reglas_categorizacion.json` (creadas antes de que este
    campo existiera) no lo traen, y deben seguir cargando sin error — solo
    dejan `comercio` en None hasta que se edite la regla para agregarlo."""

    patron: str
    categoria: str
    comercio: str | None = None


def cargar_reglas(ruta: Path = RUTA_REGLAS_POR_DEFECTO) -> list[Regla]:
    if not ruta.exists():
        return []

    datos = json.loads(ruta.read_text(encoding="utf-8"))
    return [Regla(**r) for r in datos]


def guardar_reglas(reglas: list[Regla], ruta: Path = RUTA_REGLAS_POR_DEFECTO) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    datos = [asdict(r) for r in reglas]
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


def categorizar(descripcion: str, reglas: list[Regla]) -> tuple[str | None, str | None]:
    """Devuelve (categoria, comercio) de la primera regla cuyo patrón aparece
    en la descripción (comparación insensible a mayúsculas), o (None, None)
    si ninguna aplica. `comercio` puede venir en None aun si `categoria` no
    lo está — no todas las reglas necesitan asignar un comercio."""
    descripcion_normalizada = descripcion.upper()
    for regla in reglas:
        if regla.patron.upper() in descripcion_normalizada:
            return regla.categoria, regla.comercio
    return None, None
