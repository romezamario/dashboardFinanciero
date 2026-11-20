"""Conecta la revisión de Gmail en la nube (Edge Function `revisar-gmail` de
Supabase, ver supabase/migrations/20261120030000_gmail_en_la_nube.sql) con lo
que ya tiene la app de escritorio:

* las reglas de categorización (`transform/reglas_categorizacion.json`) y los
  códigos de ciudad (`data/gastos_correo/ciudades.json`) se suben a la tabla
  `preferencias` (claves `reglas_categorizacion` y `ciudades_correo`), para que
  la nube categorice igual que la laptop;
* el permiso de Gmail de solo lectura que ya autorizaste (`data/gmail/token.json`:
  client id/secret + refresh token) se guarda con la RPC `conectar_gmail`, en
  el esquema `privado`, que la API no expone.

La app lo hace sola cada vez que revisa Gmail con subida y al sincronizar los
estados de cuenta. A mano, desde la raíz del proyecto:

    python -m sync.gmail_nube                 # sube reglas y permiso
    python -m sync.gmail_nube --revisar       # además pide una revisión ya
    python -m sync.gmail_nube --comparar 30   # verifica: relee 30 días en la
                                              # nube y compara con lo guardado
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from transform.categorizador import Regla

CLAVE_REGLAS = "reglas_categorizacion"
CLAVE_CIUDADES = "ciudades_correo"


def subir_reglas(client: Any, reglas: list[Regla], ciudades: dict[str, str]) -> None:
    """Deja en `preferencias` las reglas y ciudades actuales (upsert por
    usuario y clave). Sin reglas no se sube nada: una lista vacía en la nube
    dejaría todo "Sin categoría"."""
    if not reglas:
        return
    from sync.gastos_correo import id_usuario

    user_id = id_usuario(client)
    filas = [
        {"user_id": user_id, "clave": CLAVE_REGLAS, "valor": [asdict(r) for r in reglas]},
        {"user_id": user_id, "clave": CLAVE_CIUDADES, "valor": {k.upper(): v for k, v in ciudades.items()}},
    ]
    client.table("preferencias").upsert(filas, on_conflict="user_id,clave").execute()


SUBIDO = "subido"
SIN_TOKEN = "sin_token"
YA_CONECTADO = "ya_conectado"


def conectar_gmail_web(client: Any, ruta_token: Path) -> str:
    """Guarda en Supabase el permiso de Gmail de `token.json`.

    Devuelve SUBIDO, SIN_TOKEN (todavía no se autoriza Gmail en la app) o
    YA_CONECTADO: la nube ya tiene otro permiso que funciona (p. ej. el que se
    autorizó desde el dashboard) y `conectar_gmail` no lo reemplaza; solo lo
    hace si no hay conexión o Google la rechazó (migración
    20261120050000_gmail_autorizacion_web.sql)."""
    try:
        token = json.loads(ruta_token.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return SIN_TOKEN
    datos = {k: token.get(k) for k in ("client_id", "client_secret", "refresh_token")}
    if not all(isinstance(v, str) and v for v in datos.values()):
        return SIN_TOKEN
    respuesta = client.rpc(
        "conectar_gmail",
        {
            "p_client_id": datos["client_id"],
            "p_client_secret": datos["client_secret"],
            "p_refresh_token": datos["refresh_token"],
            "p_correo": token.get("account") or None,
        },
    ).execute()
    # La RPC devuelve false cuando no reemplazó (versiones anteriores: null).
    return YA_CONECTADO if getattr(respuesta, "data", None) is False else SUBIDO


def sincronizar_nube(client: Any) -> str:
    """Reglas + ciudades + permiso de Gmail. Devuelve el resultado de
    `conectar_gmail_web`."""
    from sync.gmail_gastos import _rutas_gmail, cargar_ciudades_extra
    from transform.categorizador import cargar_reglas

    subir_reglas(client, cargar_reglas(), cargar_ciudades_extra())
    return conectar_gmail_web(client, _rutas_gmail()[1])


SEGUNDOS_ESPERA_FUNCION = 300


def _invocar(client: Any, cuerpo: dict[str, Any]) -> Any:
    """POST a la Edge Function con tu sesión. Directo con urllib y no con
    `client.functions.invoke`: ese cliente corta a los pocos segundos y una
    revisión o comparación de varios días tarda más (2026-11-20)."""
    import os
    import urllib.error
    import urllib.request

    url = os.environ["SUPABASE_URL"].rstrip("/") + "/functions/v1/revisar-gmail"
    sesion = client.auth.get_session()
    peticion = urllib.request.Request(
        url,
        data=json.dumps(cuerpo).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": os.environ["SUPABASE_KEY"],
            "Authorization": f"Bearer {sesion.access_token}",
        },
    )
    try:
        with urllib.request.urlopen(peticion, timeout=SEGUNDOS_ESPERA_FUNCION) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        texto = e.read().decode("utf-8", "replace")
        try:
            return json.loads(texto)
        except ValueError:
            return {"error": f"HTTP {e.code}: {texto[:200]}"}


def main() -> None:
    from dotenv import load_dotenv

    from sync.gastos_correo import crear_cliente

    load_dotenv()
    ap = argparse.ArgumentParser(description="Conecta la revisión de Gmail en la nube.")
    ap.add_argument("--revisar", action="store_true", help="pide una revisión en la nube al terminar")
    ap.add_argument("--comparar", type=int, metavar="DIAS", help="relee DIAS en la nube y compara con lo guardado")
    args = ap.parse_args()

    client = crear_cliente()
    conexion = sincronizar_nube(client)
    print("Reglas y ciudades subidas.")
    print({
        SUBIDO: "Permiso de Gmail guardado en la nube.",
        YA_CONECTADO: "La nube ya tiene un permiso de Gmail que funciona (p. ej. el del dashboard); no se reemplazó.",
        SIN_TOKEN: "No hay permiso de Gmail (data/gmail/token.json).",
    }[conexion])
    if args.revisar:
        r = _invocar(client, {})
        print(f"Revisión: {r.get('resultado')} · {r.get('avisos')} avisos en la ventana, {r.get('nuevos')} nuevos, "
              f"{r.get('recategorizados')} recategorizados. {r.get('mensaje') or ''}")
    if args.comparar:
        r = _invocar(client, {"comparar": True, "dias": args.comparar})
        if "error" in r:
            print(f"Comparación: error {r['error']}")
        else:
            campos: dict[str, int] = {}
            for d in r.get("distintos", []):
                for c in d["campos"]:
                    campos[c] = campos.get(c, 0) + 1
            print(f"Comparación de {args.comparar} días: {r['avisos']} avisos, {r['iguales']} iguales, "
                  f"{len(r['distintos'])} distintos {campos or ''}, {len(r['soloEnGmail'])} sin guardar, "
                  f"{r['debitos']} débitos, {r['ilegibles']} ilegibles.")


if __name__ == "__main__":
    main()
