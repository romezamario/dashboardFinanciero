"""Normaliza RenglonCrudo (parsers/base.py) al esquema canónico de `transacciones`.

Agnóstico de banco: no sabe nada de layouts de PDF, solo de la convención que
todo extractor debe respetar (ver parsers/base.py) — monto_texto con signo,
fecha_texto en un formato consistente por extractor.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Literal

from parsers.base import RenglonCrudo

Tipo = Literal["cargo", "abono"]


class ErrorTransformacion(ValueError):
    """El renglón no se pudo normalizar (fecha o monto ilegibles)."""


@dataclass(frozen=True)
class TransaccionCanonica:
    """Corresponde 1:1 a una fila de la tabla `transacciones` (menos ids/fks).

    `categoria` no es una columna de `transacciones` (ahí vive como
    `categoria_id`, un fk resuelto contra la tabla `categorias` en Supabase)
    — aquí es solo el nombre de texto que la app le asignó en la sesión de
    revisión, para mostrar/exportar antes de sincronizar.

    `origen` tampoco es columna de `transacciones` (ese vínculo vive en
    `documento_id`, fk a `documentos`) — es el nombre del archivo PDF del
    que salió esta transacción, para distinguir renglones cuando la tabla
    de la app tiene más de un estado de cuenta cargado.
    """

    fecha: date
    descripcion: str
    monto: Decimal
    tipo: Tipo
    pagina: int
    linea_cruda: str
    moneda: str = "MXN"
    saldo: Decimal | None = None
    categoria: str | None = None
    origen: str | None = None


def transformar_monto(monto_texto: str) -> tuple[Decimal, Tipo]:
    """Convierte "-199.00"/"1,500.00" en (Decimal("199.00"), "cargo"/"abono").

    El monto en la tabla `transacciones` es siempre no-negativo (constraint
    `monto >= 0`); el signo solo determina `tipo`.
    """
    texto = monto_texto.strip().replace(",", "")
    try:
        valor = Decimal(texto)
    except InvalidOperation as exc:
        raise ErrorTransformacion(f"monto ilegible: {monto_texto!r}") from exc

    tipo: Tipo = "cargo" if valor < 0 else "abono"
    return abs(valor), tipo


def transformar_fecha(fecha_texto: str, formato: str = "%d/%m/%Y") -> date:
    """Convierte la fecha en texto del extractor a `date` ISO.

    `formato` es específico de cada banco (ej. algunos usan "DD-MMM-AAAA")
    — quien llama a `transformar_renglon` decide cuál pasar.
    """
    try:
        return datetime.strptime(fecha_texto.strip(), formato).date()
    except ValueError as exc:
        raise ErrorTransformacion(
            f"fecha ilegible: {fecha_texto!r} (formato esperado {formato!r})"
        ) from exc


def transformar_renglon(
    renglon: RenglonCrudo, formato_fecha: str = "%d/%m/%Y"
) -> TransaccionCanonica:
    """Normaliza un único renglón crudo. Lanza ErrorTransformacion si no se puede."""
    monto, tipo = transformar_monto(renglon.monto_texto)
    fecha = transformar_fecha(renglon.fecha_texto, formato_fecha)

    return TransaccionCanonica(
        fecha=fecha,
        descripcion=renglon.descripcion_texto.strip(),
        monto=monto,
        tipo=tipo,
        pagina=renglon.pagina,
        linea_cruda=renglon.linea_cruda,
    )


def transformar_renglones(
    renglones: list[RenglonCrudo], formato_fecha: str = "%d/%m/%Y"
) -> tuple[list[TransaccionCanonica], list[tuple[RenglonCrudo, ErrorTransformacion]]]:
    """Transforma varios renglones; separa los que fallan en vez de abortar todo.

    Devuelve (transacciones_ok, fallidas) — la app de escritorio decide qué
    mostrarle al usuario sobre las fallidas en vez de perderlas en silencio.
    """
    ok: list[TransaccionCanonica] = []
    fallidas: list[tuple[RenglonCrudo, ErrorTransformacion]] = []

    for renglon in renglones:
        try:
            ok.append(transformar_renglon(renglon, formato_fecha))
        except ErrorTransformacion as error:
            fallidas.append((renglon, error))

    return ok, fallidas


@dataclass(frozen=True)
class ResultadoValidacion:
    """Resultado de comparar la suma de transacciones parseadas contra el
    total que el propio estado de cuenta declara (typeado a mano por el
    usuario en la app, tomado del resumen impreso en el PDF)."""

    total_calculado: Decimal
    total_esperado: Decimal
    diferencia: Decimal
    ok: bool


def validar_contra_total(
    transacciones: list[TransaccionCanonica], total_esperado: Decimal
) -> ResultadoValidacion:
    """Suma abonos menos cargos y la compara contra `total_esperado`.

    `total_esperado` típicamente es el neto que reporta el estado de cuenta
    para el periodo (saldo actual - saldo anterior), no la suma de columnas
    por separado — así una sola validación detecta tanto renglones faltantes
    como mal clasificados (cargo interpretado como abono o viceversa).
    """
    total_calculado = sum(
        (t.monto if t.tipo == "abono" else -t.monto for t in transacciones),
        start=Decimal("0"),
    )
    diferencia = total_calculado - total_esperado

    return ResultadoValidacion(
        total_calculado=total_calculado,
        total_esperado=total_esperado,
        diferencia=diferencia,
        ok=diferencia == 0,
    )
