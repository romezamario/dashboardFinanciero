"""Qué archivos ya se subieron a Supabase y con qué contenido.

Lo comparten `sincronizador.py` (estados de cuenta, `data/procesados/`) y
`gastos_correo.py` (avisos de correo, `data/gastos_correo/`): un archivo se
vuelve a subir solo si su contenido (sha256 de los bytes, no la fecha de
modificación ni el nombre) cambió desde la última subida *exitosa*. El estado
es un JSON `{nombre_archivo: sha256}` junto a los archivos.

Cualquier problema leyéndolo (no existe, corrupto) cuenta como "no hay
estado": en el peor caso se vuelve a subir todo una vez -- idempotente --,
nunca se pierde una actualización.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


def huella(ruta: Path) -> str:
    """sha256 del contenido del archivo."""
    return hashlib.sha256(ruta.read_bytes()).hexdigest()


def cargar_estado(ruta_estado: Path) -> dict[str, str]:
    try:
        datos = json.loads(ruta_estado.read_text(encoding="utf-8"))
        return {str(k): str(v) for k, v in datos.items()}
    except (OSError, ValueError, AttributeError):
        return {}


def guardar_estado(ruta_estado: Path, estado: dict[str, str]) -> None:
    """Escribe el estado. Un fallo al escribirlo no se propaga: solo hace que
    la próxima vez se vuelva a subir lo que no quedó registrado."""
    try:
        ruta_estado.parent.mkdir(parents=True, exist_ok=True)
        ruta_estado.write_text(json.dumps(estado, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
