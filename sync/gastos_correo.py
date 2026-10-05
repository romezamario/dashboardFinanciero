"""Sube los gastos de los avisos de compra de Banamex (correo) a Supabase.

Los gastos viven en `data/gastos_correo/AAAA-MM-DD.json` (un archivo por día,
el mismo formato que escribe `sync/gmail_gastos.py`):

    {"fecha": "2026-10-03",
     "transacciones": [{"id": "<id del mensaje de Gmail>", "hora": "06:24",
                        "tarjeta": "179", "comercio": "Gasolinera",
                        "establecimiento": "GAS APODACA CENTRO APO",
                        "ciudad_cod": "APO", "ciudad": "Apodaca",
                        "categoria": "Transporte", "monto": 600, "moneda": "MXN"}]}

Escritura: inicia sesión como tú (SUPABASE_EMAIL/SUPABASE_PASSWORD del `.env`,
igual que `sincronizador.py`) y hace upsert en `gastos_correo`; la RLS solo deja
escribir filas con tu `user_id` (migración
20261004230000_gastos_correo_escritura_con_sesion.sql). Antes se subía con la
clave anon y un secreto aparte (INGESTA_CORREO_SECRETO), pensado para una tarea
en la nube sin tu contraseña; ya no hace falta.

Idempotente: upsert por (user_id, mensaje_id), así que volver a subir un día no
duplica ni cambia el total.

Como `sincronizador.py`, las funciones reciben un cliente ya construido para
poder probarlas con uno falso, sin red ni credenciales reales.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Protocol

CARPETA_GASTOS_CORREO = Path(__file__).parent.parent / "data" / "gastos_correo"
MAXIMO_POR_LLAMADA = 500  # filas por upsert


class ClienteSupabase(Protocol):
    """Solo la porción de supabase-py que este módulo usa."""

    auth: Any

    def table(self, nombre: str) -> Any: ...


@dataclass
class ResultadoGastosCorreo:
    archivo: str
    gastos_enviados: int
    ok: bool
    error: str | None = None


def _a_fila(fecha: str, t: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Convierte una transacción del archivo a una fila de `gastos_correo`. El
    monto se valida con Decimal (nunca float) y viaja como texto con dos
    decimales; Postgres lo castea a numeric(12,2)."""
    try:
        monto = Decimal(str(t["monto"])).quantize(Decimal("0.01"))
    except (InvalidOperation, KeyError) as e:
        raise ValueError(f"monto inválido en el gasto {t.get('id')!r}") from e
    if monto < 0:
        raise ValueError(f"monto negativo en el gasto {t.get('id')!r}")
    faltantes = [c for c in ("id", "hora", "tarjeta", "comercio", "categoria") if not t.get(c)]
    if faltantes:
        raise ValueError(f"al gasto {t.get('id')!r} le faltan campos: {', '.join(faltantes)}")
    return {
        # Explícito (y no por el default auth.uid()) porque es parte de la
        # llave del upsert.
        "user_id": user_id,
        "mensaje_id": t["id"],
        "fecha": fecha,
        "hora": t["hora"],
        "tarjeta": str(t["tarjeta"]),
        "comercio": t["comercio"],
        "categoria": t["categoria"],
        "establecimiento": t.get("establecimiento"),
        "ciudad_cod": t.get("ciudad_cod"),
        "ciudad": t.get("ciudad"),
        "monto": str(monto),
        "moneda": t.get("moneda") or "MXN",
    }


def id_usuario(client: ClienteSupabase) -> str:
    """El id del usuario con sesión iniciada en `client` (sin ir a la red)."""
    sesion = client.auth.get_session()
    usuario = getattr(sesion, "user", None)
    if usuario is None:
        raise ValueError("No hay sesión iniciada en Supabase.")
    return str(usuario.id)


def subir_archivo(client: ClienteSupabase, ruta: Path, user_id: str) -> ResultadoGastosCorreo:
    """Sube un día. Un día sin movimientos (`transacciones: []`) es válido y
    no llama a Supabase."""
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        fecha = datos["fecha"]
        filas = [_a_fila(fecha, t, user_id) for t in datos.get("transacciones", [])]
        for i in range(0, len(filas), MAXIMO_POR_LLAMADA):
            client.table("gastos_correo").upsert(
                filas[i : i + MAXIMO_POR_LLAMADA], on_conflict="user_id,mensaje_id"
            ).execute()
    except Exception as e:  # un archivo malo no debe frenar a los demás
        return ResultadoGastosCorreo(ruta.name, 0, False, str(e))
    return ResultadoGastosCorreo(ruta.name, len(filas), True)


def subir_todos(
    client: ClienteSupabase, carpeta: Path = CARPETA_GASTOS_CORREO
) -> list[ResultadoGastosCorreo]:
    """Sube todos los `AAAA-MM-DD.json` de la carpeta (no `ciudades.json` ni
    `preferencias.json`), del más antiguo al más nuevo, con la sesión de
    `client`. No hace falta llevar registro de lo ya subido: es idempotente y
    son pocos archivos."""
    user_id = id_usuario(client)
    return [
        subir_archivo(client, ruta, user_id) for ruta in sorted(carpeta.glob("????-??-??.json"))
    ]


def crear_cliente() -> Any:
    """Cliente real de supabase-py con tu sesión (el mismo login que usa el
    sincronizador de estados de cuenta)."""
    from sync.sincronizador import crear_cliente_autenticado

    return crear_cliente_autenticado()


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    resultados = subir_todos(crear_cliente())
    if not resultados:
        print(f"No hay archivos en {CARPETA_GASTOS_CORREO}.")
    for r in resultados:
        estado = "OK" if r.ok else f"ERROR: {r.error}"
        print(f"{r.archivo}: {r.gastos_enviados} gastos — {estado}")
    if any(not r.ok for r in resultados):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
