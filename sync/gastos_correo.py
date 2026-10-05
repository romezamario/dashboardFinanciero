"""Sube los gastos de los avisos de compra de Banamex (correo) a Supabase.

Los gastos viven en `data/gastos_correo/AAAA-MM-DD.json` (un archivo por día,
el mismo formato que guarda la tarea diaria del reporte):

    {"fecha": "2026-10-03",
     "transacciones": [{"id": "<id del mensaje de Gmail>", "hora": "06:24",
                        "tarjeta": "179", "comercio": "Gasolinera",
                        "establecimiento": "GAS APODACA CENTRO APO",
                        "ciudad_cod": "APO", "ciudad": "Apodaca",
                        "categoria": "Transporte", "monto": 600, "moneda": "MXN"}]}

Escritura: NO inicia sesión ni usa la clave service_role. Llama a la función
`ingestar_gastos_correo(p_secreto, p_gastos)` de Supabase con la clave anon;
la función solo inserta en `gastos_correo` y solo si el secreto coincide con
el hash guardado en `ingesta_correo` (ver la migración
20261004210000_add_gastos_correo.sql). El secreto vive solo en `.env`
(INGESTA_CORREO_SECRETO), igual que el resto de credenciales.

Idempotente: la función hace upsert por (user_id, mensaje_id), así que volver
a subir un día no duplica ni cambia el total.

Como `sincronizador.py`, las funciones reciben un cliente ya construido para
poder probarlas con uno falso, sin red ni credenciales reales.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Protocol

CARPETA_GASTOS_CORREO = Path(__file__).parent.parent / "data" / "gastos_correo"
MAXIMO_POR_LLAMADA = 500  # el mismo tope que valida la función SQL
SECRETO_MINIMO = 32  # la función rechaza secretos más cortos


class ClienteSupabase(Protocol):
    """Solo la porción de supabase-py que este módulo usa."""

    def rpc(self, funcion: str, parametros: dict[str, Any]) -> Any: ...


@dataclass
class ResultadoGastosCorreo:
    archivo: str
    gastos_enviados: int
    ok: bool
    error: str | None = None


def _a_fila(fecha: str, t: dict[str, Any]) -> dict[str, Any]:
    """Convierte una transacción del archivo al formato que espera la función
    SQL. El monto se valida con Decimal (nunca float) y viaja como texto con
    dos decimales; la función lo castea a numeric(12,2)."""
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


def subir_archivo(client: ClienteSupabase, ruta: Path, secreto: str) -> ResultadoGastosCorreo:
    """Sube un día. Un día sin movimientos (`transacciones: []`) es válido y
    no llama a Supabase."""
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        fecha = datos["fecha"]
        filas = [_a_fila(fecha, t) for t in datos.get("transacciones", [])]
        for i in range(0, len(filas), MAXIMO_POR_LLAMADA):
            client.rpc(
                "ingestar_gastos_correo",
                {"p_secreto": secreto, "p_gastos": filas[i : i + MAXIMO_POR_LLAMADA]},
            ).execute()
    except Exception as e:  # un archivo malo no debe frenar a los demás
        return ResultadoGastosCorreo(ruta.name, 0, False, str(e))
    return ResultadoGastosCorreo(ruta.name, len(filas), True)


def subir_todos(
    client: ClienteSupabase, secreto: str, carpeta: Path = CARPETA_GASTOS_CORREO
) -> list[ResultadoGastosCorreo]:
    """Sube todos los `AAAA-MM-DD.json` de la carpeta (no `ciudades.json`), del más
    antiguo al más nuevo.
    No hace falta llevar registro de lo ya subido: es idempotente y son pocos
    archivos."""
    if len(secreto) < SECRETO_MINIMO:
        raise ValueError(
            f"INGESTA_CORREO_SECRETO debe tener al menos {SECRETO_MINIMO} caracteres."
        )
    return [subir_archivo(client, ruta, secreto) for ruta in sorted(carpeta.glob("????-??-??.json"))]


def crear_cliente_anon():
    """Cliente real de supabase-py con la clave anon, SIN iniciar sesión.
    Import perezoso para poder probar el módulo sin tener `supabase` instalado."""
    from supabase import create_client

    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    secreto = os.environ.get("INGESTA_CORREO_SECRETO", "")
    if not secreto:
        raise SystemExit("Falta INGESTA_CORREO_SECRETO en .env (ver .env.example).")

    resultados = subir_todos(crear_cliente_anon(), secreto)
    if not resultados:
        print(f"No hay archivos en {CARPETA_GASTOS_CORREO}.")
    for r in resultados:
        estado = "OK" if r.ok else f"ERROR: {r.error}"
        print(f"{r.archivo}: {r.gastos_enviados} gastos — {estado}")
    if any(not r.ok for r in resultados):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
