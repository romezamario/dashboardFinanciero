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
    """Una transacción tal como aparece en el PDF, sin normalizar.

    `monto_texto` SIEMPRE debe traer signo: negativo para cargo, positivo
    (sin signo) para abono. Esto es responsabilidad del extractor, no del
    Transformador — cada banco decide esto distinto (algunos ya imprimen el
    signo, otros usan columnas separadas de cargo/abono), así que es el
    extractor concreto el que sabe cómo traducir su layout a esta convención
    única. Ejemplo: si un banco pone $199.00 en la columna "Cargo", el
    extractor debe emitir monto_texto="-199.00".
    """

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

    def extraer_info_cuenta(self, ruta_pdf: Path) -> tuple[str | None, str | None]:
        """Intenta leer (alias, ultimos_4_digitos) de la portada del PDF,
        para no tener que escribirlos a mano en la app cada vez.

        Devuelve (None, None) si el extractor no lo soporta o no los
        encuentra — la app deja los campos para llenar manualmente en ese
        caso. Implementación por defecto: no soportado.

        Regla dura para cualquier subclase que lo implemente: el número de
        cuenta completo NUNCA debe guardarse en ninguna variable que
        sobreviva más allá del cálculo de los últimos 4 dígitos — ni
        loggearse, ni quedar en el valor de retorno.
        """
        return None, None

    def puede_procesar(self, ruta_pdf: Path) -> bool:
        """Heurística para saber si este extractor sabe leer `ruta_pdf`,
        usada para detectar el banco automáticamente en vez de que el
        usuario lo elija a mano cada vez.

        Debe ser barata y conservadora — un falso positivo hace que se use
        el extractor equivocado. Implementación por defecto: no soportado
        (la app cae en la selección manual del dropdown para este banco).
        """
        return False

    def advertencias(self) -> list[str]:
        """Avisos no fatales sobre la última llamada a `extraer()` — por
        ejemplo, una línea que por su posición/formato parece ser una
        transacción pero cuyo contenido no se pudo leer completo (un caso
        real: una fila de "abono" renderizada como imagen en vez de texto
        seleccionable, así que no hay nada que este extractor pueda parsear
        ahí). No es un error — `extraer()` sigue devolviendo todo lo que sí
        pudo leer — es una pista para que el usuario la revise a mano contra
        el PDF antes de confiar en la validación de totales. Implementación
        por defecto: ninguna advertencia.
        """
        return []
