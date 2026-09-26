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

**Sincronización incremental** (2026-09-22): lo anterior hace que
re-sincronizar un archivo sin cambios sea *correcto* pero no gratis — sigue
siendo un find-or-create por cada banco/cuenta/documento/categoría más un
upsert de todas sus transacciones, ida y vuelta a Supabase. Con
`data/procesados/` acumulando un archivo por cada estado de cuenta jamás
cargado, "Sincronizar a Supabase..." volvía a subir TODOS esos archivos en
cada clic, aunque solo uno fuera nuevo — el usuario reportó que sincronizar
4 registros nuevos tardaba tanto como sincronizar todo el historial, porque
de hecho sincronizaba todo el historial. `sincronizar_todos` ahora se salta
un archivo si su contenido (hash sha256 de los bytes del JSON, no la fecha
de modificación ni el nombre) es idéntico al que tenía la última vez que se
sincronizó *con éxito* — ver `_estado_sync.json` más abajo. Un archivo
reprocesado (ej. recategorizado y vuelto a guardar tras cambiar una regla,
o regenerado por `_desambiguar_renglones_duplicados`) cambia de contenido
aunque el nombre (el hash del PDF) sea el mismo, así que SÍ se vuelve a
sincronizar — nunca se pierde una actualización real, solo se evita
re-subir bytes idénticos.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

CARPETA_PROCESADOS = Path(__file__).parent.parent / "data" / "procesados"

# Vive junto a los *.json de data/procesados/ (mismo gitignore, "data/procesados/*") pero
# con un nombre que `sincronizar_todos` excluye explícitamente de su propio glob de
# archivos a sincronizar -- ver ese filtro más abajo, no depende de convenciones de
# archivos ocultos que varían entre git/glob de Python/el explorador de Windows.
NOMBRE_ARCHIVO_ESTADO_SYNC = "_estado_sync.json"


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
            "tarjeta": t.get("tarjeta"),
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


def _hash_contenido(ruta: Path) -> str:
    return hashlib.sha256(ruta.read_bytes()).hexdigest()


def _cargar_estado_sync(ruta_estado: Path) -> dict[str, str]:
    """Mapa {nombre_archivo: hash_sha256} de la última sincronización
    exitosa de cada archivo. Cualquier problema leyéndolo (no existe,
    corrupto) se trata igual que "no hay estado guardado" -- en el peor
    caso eso solo hace que se re-sincronice todo una vez, nunca que se
    pierda una actualización."""
    if not ruta_estado.exists():
        return {}
    try:
        return json.loads(ruta_estado.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _guardar_estado_sync(ruta_estado: Path, estado: dict[str, str]) -> None:
    ruta_estado.write_text(
        json.dumps(estado, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def sincronizar_todos(
    client: ClienteSupabase,
    carpeta: Path = CARPETA_PROCESADOS,
    *,
    forzar_todos: bool = False,
) -> list[ResultadoSincronizacion]:
    """Sincroniza cada *.json en `carpeta` que sea nuevo o haya cambiado
    desde la última sincronización *exitosa* -- comparado por hash de
    contenido (ver `_hash_contenido`), no por fecha de modificación ni por
    nombre, así que recargar/regenerar un archivo con el mismo nombre pero
    contenido distinto sí se vuelve a sincronizar. El estado se guarda en
    `<carpeta>/_estado_sync.json` según se van sincronizando archivos con
    éxito -- uno que falla NO se marca como sincronizado, así que la
    próxima corrida lo reintenta automáticamente (mismo criterio de "no
    perder una actualización" que ya tenía este módulo). `forzar_todos=True`
    ignora el estado guardado y re-sincroniza todo, por si hace falta un
    re-push completo o el estado se corrompió de forma irrecuperable."""
    ruta_estado = carpeta / NOMBRE_ARCHIVO_ESTADO_SYNC
    estado_previo = {} if forzar_todos else _cargar_estado_sync(ruta_estado)
    estado_nuevo = dict(estado_previo)
    resultados: list[ResultadoSincronizacion] = []

    archivos = sorted(
        p for p in carpeta.glob("*.json") if p.name != NOMBRE_ARCHIVO_ESTADO_SYNC
    )

    # `finally`: si algo inesperado corta el ciclo a la mitad (p. ej. se cae
    # la red con una excepción que no hereda de Exception, o se cierra la
    # app), los archivos que SÍ se sincronizaron quedan registrados y no se
    # vuelven a subir en la próxima corrida.
    try:
        for ruta_json in archivos:
            hash_actual = _hash_contenido(ruta_json)
            if estado_previo.get(ruta_json.name) == hash_actual:
                continue  # sin cambios desde la última sincronización exitosa

            # Leer el JSON va DENTRO del try: un archivo corrupto o a medio
            # escribir se reporta como fallido y el resto se sincroniza igual
            # (antes, un solo JSON ilegible abortaba toda la sincronización).
            datos: dict[str, Any] = {}
            try:
                datos = json.loads(ruta_json.read_text(encoding="utf-8"))
                resultado = sincronizar_documento(client, datos)
                resultado.archivo = ruta_json.name
                estado_nuevo[ruta_json.name] = hash_actual
            except Exception as error:  # noqa: BLE001 — se reporta, no se aborta el resto
                resultado = ResultadoSincronizacion(
                    archivo=ruta_json.name,
                    documento_hash=datos.get("documento_hash"),
                    transacciones_sincronizadas=0,
                    ok=False,
                    error=str(error),
                )
            resultados.append(resultado)
    finally:
        _guardar_estado_sync(ruta_estado, estado_nuevo)
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
