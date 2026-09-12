"""Interfaz común que debe implementar cada extractor de banco.

Un extractor NO normaliza nada — solo encuentra las líneas de transacción en
el PDF y devuelve su contenido tal cual aparece impreso. Parsear fechas a ISO,
convertir montos a Decimal, determinar cargo/abono y enmascarar cuentas es
responsabilidad del Transformador (fase 3), que es agnóstico de banco.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RenglonCrudo:
    """Una transacción tal como aparece en el PDF, sin normalizar."""

    fecha_texto: str
    descripcion_texto: str
    monto_texto: str
    pagina: int
    linea_cruda: str


class BaseParser(ABC):
    """Interfaz común para los extractores de estados de cuenta.

    Cada banco tiene un layout de PDF distinto, así que cada subclase decide
    cómo encontrar sus líneas de transacción. Lo único que comparten es esta
    interfaz: reciben la ruta de un PDF y devuelven una lista de renglones
    crudos, uno por transacción encontrada.
    """

    nombre_banco: str

    @abstractmethod
    def extraer(self, ruta_pdf: Path) -> list[RenglonCrudo]:
        """Lee `ruta_pdf` y devuelve un renglón crudo por cada transacción.

        Una línea del PDF que no se puede interpretar como transacción
        (encabezados, totales, saldos, pies de página) se omite en silencio
        — no es un error del extractor, es contenido que no nos interesa.
        """
        raise NotImplementedError
