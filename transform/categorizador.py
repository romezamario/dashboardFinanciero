"""Categoriza transacciones por reglas de palabra clave sobre la descripción.

Las reglas son datos, no código: viven en un JSON editable (por defecto
`transform/reglas_categorizacion.json`, ignorado por git por ser información
personal — de dónde gastas — igual que los PDFs). La app de escritorio las
lee/escribe con las funciones de este módulo; también se pueden editar el
JSON a mano.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

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


class _ConCategoria(Protocol):
    descripcion: str
    categoria: str | None
    comercio: str | None


# Mínimo de caracteres para buscar el texto tecleado DENTRO de otras
# descripciones ya cargadas: con menos ("UB", "A") casi todo coincidiría.
MINIMO_CARACTERES_COINCIDENCIA_PARCIAL = 3


def inferir_categoria_comercio(
    descripcion: str,
    reglas: list[Regla],
    cargadas: Iterable[_ConCategoria],
) -> tuple[str | None, str | None]:
    """Como `categorizar`, pero si ninguna regla aplica intenta deducir
    (categoria, comercio) de lo que YA está cargado: para el renglón manual,
    una fila que el extractor no pudo leer suele parecerse a otras del mismo
    estado de cuenta. Orden (primero que dé resultado gana):

    1. Reglas actuales (`categorizar`) -- la fuente de verdad, igual que una
       fila extraída del PDF.
    2. Cargadas con la MISMA descripción (sin importar mayúsculas).
    3. Cargadas cuya descripción CONTIENE el texto tecleado (mínimo
       `MINIMO_CARACTERES_COINCIDENCIA_PARCIAL` caracteres).

    En 2 y 3, si varias coinciden se elige el par (categoria, comercio) más
    frecuente; solo cuentan las que ya tienen categoría. Sin nada, (None, None).
    """
    categoria, comercio = categorizar(descripcion, reglas)
    if categoria is not None:
        return categoria, comercio

    texto = descripcion.strip().upper()
    if not texto:
        return None, None

    con_categoria = [t for t in cargadas if t.categoria is not None]

    def mas_frecuente(coincidencias: list[_ConCategoria]) -> tuple[str | None, str | None]:
        if not coincidencias:
            return None, None
        pares = Counter((t.categoria, t.comercio) for t in coincidencias)
        return pares.most_common(1)[0][0]

    exactas = [t for t in con_categoria if t.descripcion.strip().upper() == texto]
    if exactas:
        return mas_frecuente(exactas)

    if len(texto) >= MINIMO_CARACTERES_COINCIDENCIA_PARCIAL:
        return mas_frecuente([t for t in con_categoria if texto in t.descripcion.upper()])
    return None, None
