"""Sube data/procesados/*.json a Supabase — upsert idempotente.

No construye el cliente de Supabase por sí mismo (eso vive en `main()` /
`app/main.py`): las funciones de este módulo reciben un cliente ya
autenticado, para poder probarlas contra un cliente falso sin tocar la
red ni credenciales reales.

Autenticación: el cliente debe iniciar sesión como un usuario real de
Supabase Auth (`client.auth.sign_in_with_password(...)`) antes de llamar
a estas funciones — las políticas de RLS exigen `user_id = auth.uid()`,
así que sin sesión iniciada cada insert es rechazado.

Idempotencia: cada entidad se busca por su clave única antes de
insertarla (find-or-create); las transacciones se suben con
`upsert(..., on_conflict="documento_id,pagina,linea_cruda")`, que es
exactamente el constraint único de la tabla — volver a sincronizar el
mismo documento no duplica nada.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

CARPETA_PROCESADOS = Path(__file__).parent.parent / "data" / "procesados"


class ClienteSupabase(Protocol):
    """Solo la porción de la interfaz de supabase-py que este módulo usa
    — permite probar la lógica con un cliente falso en vez de contra red."""

    def table(self, nombre: str) -> Any: ...


@dataclass
class ResultadoSincronizacion:
    archivo: str
    documento_hash: str | None
    transacciones_sincronizadas: int
    ok: bool
    error: str | None = None


def _buscar_o_crear(
    client: ClienteSupabase, tabla: str, filtro: dict[str, Any], datos_si_no_existe: dict[str, Any]
) -> str:
    """Busca una fila por igualdad exacta en cada campo de `filtro`; si no
    existe, la inserta con `datos_si_no_existe`. Devuelve su `id`."""
    consulta = client.table(tabla).select("id")
    for campo, valor in filtro.items():
        consulta = consulta.eq(campo, valor)
    resultado = consulta.execute()
    if resultado.data:
        return resultado.data[0]["id"]

    insertado = client.table(tabla).insert(datos_si_no_existe).execute()
    return insertado.data[0]["id"]


def sincronizar_documento(client: ClienteSupabase, datos: dict[str, Any]) -> ResultadoSincronizacion:
    """Sincroniza un único documento (el contenido de un data/procesados/*.json)."""

    banco_id = _buscar_o_crear(
        client, "bancos",
        {"nombre": datos["banco"]},
        {"nombre": datos["banco"]},
    )

    cuenta_id = _buscar_o_crear(
        client, "cuentas",
        {
            "banco_id": banco_id,
            "ultimos_4_digitos": datos["cuenta_ultimos_4_digitos"],
        },
        {
            "banco_id": banco_id,
            "alias": datos["cuenta_alias"],
            "ultimos_4_digitos": datos["cuenta_ultimos_4_digitos"],
        },
    )

    documento_id = _buscar_o_crear(
        client, "documentos",
        {"hash": datos["documento_hash"]},
        {
            "cuenta_id": cuenta_id,
            "hash": datos["documento_hash"],
            "ruta_local": datos.get("ruta_pdf_original"),
        },
    )

    nombres_categoria = {
        t["categoria"] for t in datos["transacciones"] if t.get("categoria")
    }
    categoria_ids: dict[str, str] = {
        nombre: _buscar_o_crear(
            client, "categorias", {"nombre": nombre}, {"nombre": nombre}
        )
        for nombre in nombres_categoria
    }

    filas_transacciones = [
        {
            "documento_id": documento_id,
            "categoria_id": categoria_ids.get(t["categoria"]),
            "fecha": t["fecha"],
            "descripcion": t["descripcion"],
            "comercio": t.get("comercio"),
            # monto/saldo viajan como texto ("199.00"), nunca como float de
            # Python — Postgres los castea a numeric en el servidor.
            "monto": t["monto"],
            "tipo": t["tipo"],
            "moneda": t["moneda"],
            "saldo": t.get("saldo"),
            "pagina": t["pagina"],
            "linea_cruda": t["linea_cruda"],
        }
        for t in datos["transacciones"]
    ]

    if filas_transacciones:
        client.table("transacciones").upsert(
            filas_transacciones, on_conflict="documento_id,pagina,linea_cruda"
        ).execute()

    return ResultadoSincronizacion(
        archivo="",
        documento_hash=datos["documento_hash"],
        transacciones_sincronizadas=len(filas_transacciones),
        ok=True,
    )


def sincronizar_todos(
    client: ClienteSupabase, carpeta: Path = CARPETA_PROCESADOS
) -> list[ResultadoSincronizacion]:
    resultados: list[ResultadoSincronizacion] = []

    for ruta_json in sorted(carpeta.glob("*.json")):
        datos = json.loads(ruta_json.read_text(encoding="utf-8"))
        try:
            resultado = sincronizar_documento(client, datos)
            resultado.archivo = ruta_json.name
        except Exception as error:  # noqa: BLE001 — se reporta, no se aborta el resto
            resultado = ResultadoSincronizacion(
                archivo=ruta_json.name,
                documento_hash=datos.get("documento_hash"),
                transacciones_sincronizadas=0,
                ok=False,
                error=str(error),
            )
        resultados.append(resultado)

    return resultados


def crear_cliente_autenticado():
    """Construye un cliente real de supabase-py y lo autentica con las
    credenciales de .env. Import perezoso de `supabase` para que este
    módulo se pueda probar sin tener el paquete instalado."""
    from supabase import create_client

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_KEY"]
    email = os.environ["SUPABASE_EMAIL"]
    password = os.environ["SUPABASE_PASSWORD"]

    client = create_client(url, key)
    client.auth.sign_in_with_password({"email": email, "password": password})
    return client


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    client = crear_cliente_autenticado()
    resultados = sincronizar_todos(client)

    for r in resultados:
        estado = "OK" if r.ok else f"ERROR: {r.error}"
        print(f"{r.archivo}: {r.transacciones_sincronizadas} transacciones — {estado}")


if __name__ == "__main__":
    main()
