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

from sync.estado_incremental import cargar_estado, guardar_estado, huella

CARPETA_GASTOS_CORREO = Path(__file__).parent.parent / "data" / "gastos_correo"
MAXIMO_POR_LLAMADA = 500  # filas por upsert
# Qué archivos ya se subieron y con qué contenido (nombre -> sha256). Con años
# de historial son cientos de archivos: sin esto cada revisión volvía a subirlos
# todos (una llamada por día).
NOMBRE_ARCHIVO_ESTADO = "_estado_subida.json"


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


def _filas_del_archivo(ruta: Path, user_id: str) -> list[dict[str, Any]]:
    """Las filas de un día, validadas. Un día sin movimientos
    (`transacciones: []`) es válido y no aporta filas."""
    datos = json.loads(ruta.read_text(encoding="utf-8"))
    fecha = datos["fecha"]
    return [_a_fila(fecha, t, user_id) for t in datos.get("transacciones", [])]


def _subir_filas(client: ClienteSupabase, filas: list[dict[str, Any]]) -> None:
    """Upsert en llamadas de hasta `MAXIMO_POR_LLAMADA` filas. Un mismo
    mensaje repetido en la tanda (no debería pasar: cada aviso vive en un solo
    día) se manda una vez -- gana el último --, porque Postgres rechaza la
    llamada entera si dos filas comparten la llave del upsert (error 21000)."""
    unicas = list({f["mensaje_id"]: f for f in filas}.values())
    for i in range(0, len(unicas), MAXIMO_POR_LLAMADA):
        client.table("gastos_correo").upsert(
            unicas[i : i + MAXIMO_POR_LLAMADA], on_conflict="user_id,mensaje_id"
        ).execute()


def subir_archivo(client: ClienteSupabase, ruta: Path, user_id: str) -> ResultadoGastosCorreo:
    """Sube un día por su cuenta (sin juntarlo con otros)."""
    try:
        filas = _filas_del_archivo(ruta, user_id)
        _subir_filas(client, filas)
    except Exception as e:  # un archivo malo no debe frenar a los demás
        return ResultadoGastosCorreo(ruta.name, 0, False, str(e))
    return ResultadoGastosCorreo(ruta.name, len(filas), True)


def subir_todos(
    client: ClienteSupabase, carpeta: Path = CARPETA_GASTOS_CORREO, forzar: bool = False
) -> list[ResultadoGastosCorreo]:
    """Sube los `AAAA-MM-DD.json` de la carpeta (no `ciudades.json`, `debitos.json`
    ni `preferencias.json`), del más antiguo al más nuevo, con la sesión de
    `client`. Salta los archivos cuyo contenido es el mismo de la última subida
    exitosa (`_estado_subida.json`, ver `sync/estado_incremental.py`); un archivo
    que falla no se registra, así que la próxima vez se reintenta. `forzar=True`
    los sube todos otra vez (p. ej. si se borraron filas en Supabase a mano).
    Solo devuelve los que se intentaron subir. Sigue siendo idempotente: el
    upsert no duplica.

    Los días que cambiaron se juntan en tandas de hasta `MAXIMO_POR_LLAMADA`
    filas (sin partir un día entre tandas): con la carga de todo el historial
    son cientos de días de unos pocos gastos, y antes iba una llamada por día.
    Si una tanda falla, todos sus días se reportan con ese error y se
    reintentan la próxima vez; un día con datos inválidos falla solo, sin
    enviarse."""
    user_id = id_usuario(client)
    ruta_estado = carpeta / NOMBRE_ARCHIVO_ESTADO
    estado = {} if forzar else cargar_estado(ruta_estado)
    resultados: list[ResultadoGastosCorreo] = []
    # Días listos para subir: (nombre, huella, filas).
    tanda: list[tuple[str, str, list[dict[str, Any]]]] = []

    def subir_tanda() -> None:
        if not tanda:
            return
        try:
            _subir_filas(client, [f for _, _, filas in tanda for f in filas])
            error = None
        except Exception as e:  # noqa: BLE001 -- se reporta por día, no se aborta
            error = str(e)
        for nombre, huella_dia, filas in tanda:
            if error is None:
                resultados.append(ResultadoGastosCorreo(nombre, len(filas), True))
                estado[nombre] = huella_dia
            else:
                resultados.append(ResultadoGastosCorreo(nombre, 0, False, error))
                estado.pop(nombre, None)
        tanda.clear()

    try:
        for ruta in sorted(carpeta.glob("????-??-??.json")):
            try:
                huella_dia = huella(ruta)
            except OSError as e:
                resultados.append(ResultadoGastosCorreo(ruta.name, 0, False, str(e)))
                continue
            if estado.get(ruta.name) == huella_dia:
                continue
            try:
                filas = _filas_del_archivo(ruta, user_id)
            except Exception as e:  # noqa: BLE001 -- un archivo malo no frena a los demás
                resultados.append(ResultadoGastosCorreo(ruta.name, 0, False, str(e)))
                estado.pop(ruta.name, None)
                continue
            if tanda and sum(len(f) for _, _, f in tanda) + len(filas) > MAXIMO_POR_LLAMADA:
                subir_tanda()
            tanda.append((ruta.name, huella_dia, filas))
        subir_tanda()
    finally:
        # Aunque algo corte el ciclo, lo que ya se subió queda registrado.
        guardar_estado(ruta_estado, estado)
    return resultados


def crear_cliente() -> Any:
    """Cliente real de supabase-py con tu sesión (el mismo login que usa el
    sincronizador de estados de cuenta)."""
    from sync.sincronizador import crear_cliente_autenticado

    return crear_cliente_autenticado()


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    import sys

    resultados = subir_todos(crear_cliente(), forzar="--forzar" in sys.argv)
    if not resultados:
        print(f"Nada que subir en {CARPETA_GASTOS_CORREO} (usa --forzar para subirlo todo otra vez).")
    for r in resultados:
        estado = "OK" if r.ok else f"ERROR: {r.error}"
        print(f"{r.archivo}: {r.gastos_enviados} gastos — {estado}")
    if any(not r.ok for r in resultados):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
