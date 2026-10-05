"""Lee los avisos de compra de Banamex en Gmail y deja los gastos en
`data/gastos_correo/AAAA-MM-DD.json` (un archivo por día, hora de CDMX), que
luego sube `sync/gastos_correo.py` a la tabla `gastos_correo` de Supabase.

Todo corre en tu computadora: Gmail se lee con OAuth de solo lectura
(`gmail.readonly`) y las categorías salen de tu `transform/reglas_categorizacion.json`
con el mismo `categorizador` que usa la app de escritorio. Nada de esto pasa
por la nube.

Uso: desde la app de escritorio (pestaña "Gastos recientes (Gmail)", que llama a
`revisar_gmail()`), o desde la raíz del proyecto:

    python -m sync.gmail_gastos                 # últimos 3 días, solo escribe archivos
    python -m sync.gmail_gastos --dias 10       # ventana más grande
    python -m sync.gmail_gastos --subir         # además sube a Supabase

Idempotente: volver a correrlo no duplica nada. Si un día ya tiene archivo se
mezcla por id de mensaje de Gmail (lo nuevo reemplaza lo viejo, no se pierde
nada), y la subida hace upsert por (user_id, mensaje_id).

Configuración de Gmail (una sola vez):
  1. En https://console.cloud.google.com crea un proyecto, activa la "Gmail API".
  2. Pantalla de consentimiento OAuth: tipo "Externo", agrégate como usuario. Para
     que el permiso no caduque cada 7 días, pasa la app a "En producción" (es solo
     para ti; Google mostrará un aviso de "app no verificada" que puedes aceptar).
  3. Credenciales -> "ID de cliente de OAuth" -> tipo "App de escritorio".
     Descarga el JSON y guárdalo como `data/gmail/credentials.json`
     (o apunta GMAIL_CREDENTIALS_FILE a donde quieras).
  4. La primera corrida abre el navegador para autorizar y guarda el permiso en
     `data/gmail/token.json` (GMAIL_TOKEN_FILE). Ambos archivos están en .gitignore.

Ciudad: el Establecimiento termina con un código de 3 letras (MCA, APO, CIU...).
Los confirmados están en `CIUDADES_CONFIRMADAS`; los demás se guardan solo como
código (la pestaña los muestra en gris) hasta que los agregues en
`data/gastos_correo/ciudades.json`, por ejemplo {"CIU": "Ciudad Apodaca"}.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
from dataclasses import dataclass, field
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Protocol

if TYPE_CHECKING:
    from sync.gastos_correo import ResultadoGastosCorreo

from transform.categorizador import Regla, cargar_reglas, categorizar

RAIZ = Path(__file__).parent.parent
CARPETA_GASTOS_CORREO = RAIZ / "data" / "gastos_correo"
CREDENCIALES_POR_DEFECTO = RAIZ / "data" / "gmail" / "credentials.json"
TOKEN_POR_DEFECTO = RAIZ / "data" / "gmail" / "token.json"
ALCANCES = ["https://www.googleapis.com/auth/gmail.readonly"]
CONSULTA_GMAIL = "from:notificaciones@banamex.com subject:Retiro newer_than:{dias}d"

# Códigos de 3 letras al final del Establecimiento confirmados por el usuario.
CIUDADES_CONFIRMADAS = {"MCA": "McAllen", "APO": "Apodaca"}
# Códigos que son el PAÍS, no la ciudad (ej. "TELEVIA CADEREYTA MEX"): la ciudad
# es la palabra anterior.
CODIGOS_PAIS = {"MEX"}

MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}


# Patrón de los archivos por día (deja fuera ciudades.json y preferencias.json).
PATRON_ARCHIVO_DIA = "????-??-??.json"


# ---------------------------------------------------------------------------
# Problemas esperables: mensajes en español listos para mostrarle al usuario
# (la app de escritorio los enseña tal cual; el CLI los convierte en SystemExit)
# ---------------------------------------------------------------------------


class ErrorGastosGmail(Exception):
    """Problema esperable de configuración o permisos, no un bug."""


class FaltanLibreriasGoogle(ErrorGastosGmail):
    pass


class FaltanCredencialesGmail(ErrorGastosGmail):
    pass


class PermisoGmailInvalido(ErrorGastosGmail):
    """El permiso guardado venció, se revocó o no existe: hay que reautorizar."""


class FaltaConfiguracionSupabase(ErrorGastosGmail):
    """Falta algo del .env de Supabase, o no se pudo iniciar sesión."""


# ---------------------------------------------------------------------------
# Lectura del aviso (HTML) -- funciones puras, sin red
# ---------------------------------------------------------------------------


class _Textos(HTMLParser):
    """Junta los fragmentos de texto del HTML, en orden, ya sin entidades y
    con los espacios colapsados (el aviso rellena con \\n, tabs y &nbsp;)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.textos: list[str] = []

    def handle_data(self, data: str) -> None:
        limpio = " ".join(data.split())
        if limpio:
            self.textos.append(limpio)


def _valor_tras(textos: list[str], etiqueta: str) -> str | None:
    """En el aviso cada dato es una fila etiqueta/valor: el valor es el
    fragmento de texto que sigue a la etiqueta."""
    for i, t in enumerate(textos[:-1]):
        if t == etiqueta:
            return textos[i + 1]
    return None


def _fecha_hora(texto: str) -> tuple[str, str] | None:
    """Devuelve (AAAA-MM-DD, HH:MM) en hora CDMX. Dos formatos reales:
    "03 Octubre 2026 / 13:22:26" (tarjeta adicional, 24 h) y
    "2026/10/3 12:01:01 PM" (tarjeta titular, 12 h con AM/PM)."""
    m = re.fullmatch(r"(\d{1,2}) (\w+) (\d{4}) / (\d{1,2}):(\d{2}):(\d{2})", texto)
    if m:
        mes = MESES.get(m.group(2).lower())
        if mes is None:
            return None
        dia, anio, hora, minuto = int(m.group(1)), int(m.group(3)), int(m.group(4)), m.group(5)
        return f"{anio:04d}-{mes:02d}-{dia:02d}", f"{hora:02d}:{minuto}"
    m = re.fullmatch(r"(\d{4})/(\d{1,2})/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)", texto)
    if m:
        hora = int(m.group(4)) % 12 + (12 if m.group(7) == "PM" else 0)
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}", f"{hora:02d}:{m.group(5)}"
    return None


def parsear_aviso(html: str, mensaje_id: str) -> dict[str, Any] | None:
    """Convierte el HTML de un aviso "Retiro/Compra con tarjeta ..." en un dict
    {id, fecha, hora, tarjeta, establecimiento, monto: Decimal}, o None si no
    es un cargo exitoso que se pueda leer completo (otro tipo de aviso, estatus
    distinto de "Exitoso", o un campo que no se pudo leer: nunca se adivina)."""
    p = _Textos()
    p.feed(html)
    textos = p.textos

    if not any(re.search(r"Retiro\s*/\s*Compra", t) for t in textos):
        return None
    if (_valor_tras(textos, "Estatus") or "").lower() != "exitoso":
        return None

    monto_txt = _valor_tras(textos, "Monto") or ""
    m = re.search(r"\$\s*([\d,]+\.\d{2})", monto_txt)
    establecimiento = _valor_tras(textos, "Establecimiento")
    fecha_hora = _fecha_hora(_valor_tras(textos, "Fecha y hora") or "")

    tarjeta = None
    for t in textos:
        mt = re.search(r"Adicional\s+(\d{3,4})\b", t, re.IGNORECASE) or re.search(r"\*\*(\d{3,4})\b", t)
        if mt:
            tarjeta = mt.group(1)
            break

    if not (m and establecimiento and fecha_hora and tarjeta):
        return None
    return {
        "id": mensaje_id,
        "fecha": fecha_hora[0],
        "hora": fecha_hora[1],
        "tarjeta": tarjeta,
        "establecimiento": establecimiento,
        "monto": Decimal(m.group(1).replace(",", "")),
    }


def ciudad_de(establecimiento: str, extra: dict[str, str] | None = None) -> tuple[str, str | None]:
    """(código, ciudad|None). El código son las 3 últimas letras del
    Establecimiento (a veces pegado al nombre: "BATH AND BODY WORKS#55MCA").
    La ciudad solo se devuelve si el código está confirmado; si no, None."""
    texto = establecimiento.strip()
    codigo = texto[-3:].upper()
    confirmadas = {**CIUDADES_CONFIRMADAS, **(extra or {})}
    if codigo in CODIGOS_PAIS:
        palabras = texto.split()
        return codigo, palabras[-2].title() if len(palabras) >= 2 else None
    return codigo, confirmadas.get(codigo)


def _comercio_legible(establecimiento: str) -> str:
    """Nombre de comercio cuando ninguna regla lo define: el establecimiento
    sin el código de ciudad final."""
    return establecimiento.strip()[:-3].strip().title() or establecimiento.strip().title()


def a_gasto(aviso: dict[str, Any], reglas: list[Regla], ciudades_extra: dict[str, str] | None = None) -> dict[str, Any]:
    """Aviso ya leído -> gasto en el formato de `data/gastos_correo`: categoría
    y comercio con tus reglas reales ("Sin categoría" si ninguna aplica)."""
    categoria, comercio = categorizar(aviso["establecimiento"], reglas)
    codigo, ciudad = ciudad_de(aviso["establecimiento"], ciudades_extra)
    gasto: dict[str, Any] = {
        "id": aviso["id"],
        "hora": aviso["hora"],
        "tarjeta": aviso["tarjeta"],
        "comercio": comercio or _comercio_legible(aviso["establecimiento"]),
        "establecimiento": aviso["establecimiento"],
        "ciudad_cod": codigo,
        "categoria": categoria or "Sin categoría",
        "monto": float(aviso["monto"]),
        "moneda": "MXN",
    }
    if ciudad:
        gasto["ciudad"] = ciudad
    return gasto


def agrupar_por_dia(avisos: list[dict[str, Any]], reglas: list[Regla], ciudades_extra: dict[str, str] | None = None) -> dict[str, list[dict[str, Any]]]:
    dias: dict[str, list[dict[str, Any]]] = {}
    for aviso in avisos:
        dias.setdefault(aviso["fecha"], []).append(a_gasto(aviso, reglas, ciudades_extra))
    for gastos in dias.values():
        gastos.sort(key=lambda g: (g["hora"], g["id"]))
    return dias


def escribir_dias(dias: dict[str, list[dict[str, Any]]], carpeta: Path = CARPETA_GASTOS_CORREO) -> list[Path]:
    """Un archivo por día. Si ya existe se mezcla por id (lo nuevo reemplaza a
    lo viejo): una ventana que corta a mitad de día no borra gastos previos."""
    carpeta.mkdir(parents=True, exist_ok=True)
    escritos = []
    for fecha, gastos in sorted(dias.items()):
        ruta = carpeta / f"{fecha}.json"
        por_id: dict[str, dict[str, Any]] = {}
        if ruta.exists():
            previo = json.loads(ruta.read_text(encoding="utf-8"))
            por_id = {g["id"]: g for g in previo.get("transacciones", [])}
        por_id.update({g["id"]: g for g in gastos})
        ordenados = sorted(por_id.values(), key=lambda g: (g["hora"], g["id"]))
        ruta.write_text(
            json.dumps({"fecha": fecha, "transacciones": ordenados}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        escritos.append(ruta)
    return escritos


def cargar_ciudades_extra(carpeta: Path = CARPETA_GASTOS_CORREO) -> dict[str, str]:
    ruta = carpeta / "ciudades.json"
    if not ruta.exists():
        return {}
    return {k.upper(): v for k, v in json.loads(ruta.read_text(encoding="utf-8")).items()}


def ids_guardados(carpeta: Path = CARPETA_GASTOS_CORREO) -> set[str]:
    """Ids de mensaje que ya están en los archivos por día (para contar cuáles
    son nuevos). Un archivo ilegible simplemente no aporta ids."""
    ids: set[str] = set()
    for ruta in carpeta.glob(PATRON_ARCHIVO_DIA):
        try:
            datos = json.loads(ruta.read_text(encoding="utf-8"))
            ids |= {g["id"] for g in datos.get("transacciones", []) if "id" in g}
        except (OSError, ValueError, TypeError, AttributeError):
            continue
    return ids


def cargar_gastos_recientes(
    carpeta: Path = CARPETA_GASTOS_CORREO, limite: int = 200
) -> tuple[list[dict[str, Any]], list[str]]:
    """(gastos más recientes primero, cada uno con su "fecha"; archivos que no
    se pudieron leer). Para la tabla de la app de escritorio."""
    gastos: list[dict[str, Any]] = []
    ilegibles: list[str] = []
    for ruta in carpeta.glob(PATRON_ARCHIVO_DIA):
        try:
            datos = json.loads(ruta.read_text(encoding="utf-8"))
            fecha = datos.get("fecha") or ruta.stem
            gastos += [{**g, "fecha": fecha} for g in datos.get("transacciones", [])]
        except (OSError, ValueError, TypeError, AttributeError):
            ilegibles.append(ruta.name)
    gastos.sort(key=lambda g: (g["fecha"], str(g.get("hora", "")), str(g.get("id", ""))), reverse=True)
    return gastos[:limite], sorted(ilegibles)


# ---------------------------------------------------------------------------
# Gmail
# ---------------------------------------------------------------------------


class ServicioGmail(Protocol):
    """Solo la porción de la API de Gmail que se usa (para probar con uno falso)."""

    def users(self) -> Any: ...


def html_del_mensaje(mensaje: dict[str, Any]) -> str | None:
    """Busca la parte text/html (a cualquier profundidad) y la decodifica."""

    def buscar(parte: dict[str, Any]) -> str | None:
        if parte.get("mimeType") == "text/html" and parte.get("body", {}).get("data"):
            datos = parte["body"]["data"]
            return base64.urlsafe_b64decode(datos + "=" * (-len(datos) % 4)).decode("utf-8", errors="replace")
        for hija in parte.get("parts", []) or []:
            encontrado = buscar(hija)
            if encontrado:
                return encontrado
        return None

    return buscar(mensaje.get("payload", {}))


def leer_avisos(
    servicio: ServicioGmail,
    dias: int,
    progreso: Callable[[int, int], None] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Devuelve (avisos leídos, ids que no se pudieron leer). Los ids que no
    son un cargo exitoso legible se reportan para que no se pierdan en silencio.
    `progreso(leidos, total)` se llama tras cada correo (para la barra de la app)."""
    mensajes = servicio.users().messages()
    ids: list[str] = []
    pagina = None
    while True:
        resp = mensajes.list(
            userId="me", q=CONSULTA_GMAIL.format(dias=dias), maxResults=500, pageToken=pagina
        ).execute()
        ids += [m["id"] for m in resp.get("messages", [])]
        pagina = resp.get("nextPageToken")
        if not pagina:
            break

    avisos, ilegibles = [], []
    if progreso:
        progreso(0, len(ids))
    for n, mid in enumerate(ids, start=1):
        html = html_del_mensaje(mensajes.get(userId="me", id=mid, format="full").execute())
        aviso = parsear_aviso(html, mid) if html else None
        if aviso:
            avisos.append(aviso)
        else:
            ilegibles.append(mid)
        if progreso:
            progreso(n, len(ids))
    return avisos, ilegibles


def _rutas_gmail() -> tuple[Path, Path]:
    credenciales = Path(os.environ.get("GMAIL_CREDENTIALS_FILE", CREDENCIALES_POR_DEFECTO))
    token = Path(os.environ.get("GMAIL_TOKEN_FILE", TOKEN_POR_DEFECTO))
    return credenciales, token


def hay_permiso_guardado() -> bool:
    """Si ya se autorizó Gmail alguna vez (existe el token). No lo lee."""
    return _rutas_gmail()[1].exists()


def _es_permiso_invalido(error: Exception) -> bool:
    """RefreshError (token vencido o revocado) o un 401 de la API."""
    try:
        from google.auth.exceptions import RefreshError

        if isinstance(error, RefreshError):
            return True
    except ImportError:
        pass
    respuesta = getattr(error, "resp", None)
    return getattr(respuesta, "status", None) == 401


MENSAJE_PERMISO_INVALIDO = (
    "El permiso de Gmail venció o fue revocado. Vuelve a autorizar el acceso "
    "(solo lectura) a tu cuenta de Gmail."
)


def crear_servicio_gmail(forzar_autorizacion: bool = False, permitir_autorizar: bool = True):
    """Servicio real de la API de Gmail con OAuth de solo lectura. Imports
    perezosos para poder probar el módulo (y abrir la app) sin las librerías de
    Google.

    `forzar_autorizacion` ignora el permiso guardado y abre el navegador para
    autorizar de nuevo (botón "Reautorizar Gmail" de la app). Con
    `permitir_autorizar=False` nunca abre el navegador: si hace falta autorizar,
    lanza `PermisoGmailInvalido` (revisión automática al abrir la app)."""
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError as error:
        raise FaltanLibreriasGoogle(
            f"Faltan las librerías de Google ({error.name}). Instálalas con:\n"
            "pip install -r requirements.txt"
        ) from error

    credenciales, token = _rutas_gmail()

    creds = None
    if token.exists() and not forzar_autorizacion:
        try:
            creds = Credentials.from_authorized_user_file(str(token), ALCANCES)
        except ValueError:
            creds = None  # token corrupto o de otro formato: hay que reautorizar
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except Exception as error:  # noqa: BLE001
            if _es_permiso_invalido(error):
                raise PermisoGmailInvalido(MENSAJE_PERMISO_INVALIDO) from error
            raise
    elif not creds or not creds.valid:
        if not permitir_autorizar:
            raise PermisoGmailInvalido(MENSAJE_PERMISO_INVALIDO)
        if not credenciales.exists():
            raise FaltanCredencialesGmail(
                f"Falta {credenciales}. Descarga el ID de cliente OAuth (tipo \"App de "
                "escritorio\") de Google Cloud y guárdalo con ese nombre; los pasos están "
                "en la sección 'Configuración de Gmail' de sync/gmail_gastos.py."
            )
        creds = InstalledAppFlow.from_client_secrets_file(str(credenciales), ALCANCES).run_local_server(port=0)
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text(creds.to_json(), encoding="utf-8")
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# ---------------------------------------------------------------------------
# Flujo completo: Gmail -> data/gastos_correo -> (opcional) Supabase
# ---------------------------------------------------------------------------


@dataclass
class ResumenDia:
    fecha: str
    gastos: int
    total: Decimal


@dataclass
class ResultadoRevision:
    """Lo que pasó en una revisión, para que la app (o el CLI) lo muestre."""

    dias: int
    avisos_leidos: int = 0
    nuevos: int = 0
    por_dia: list[ResumenDia] = field(default_factory=list)
    ilegibles: list[str] = field(default_factory=list)
    sin_categoria: list[str] = field(default_factory=list)
    codigos_sin_confirmar: list[str] = field(default_factory=list)
    sin_reglas: bool = False
    # None = no se pidió subir.
    subidas: list[ResultadoGastosCorreo] | None = None

    @property
    def gastos_subidos(self) -> int:
        return sum(r.gastos_enviados for r in self.subidas or [] if r.ok)

    @property
    def subidas_fallidas(self) -> list[ResultadoGastosCorreo]:
        return [r for r in self.subidas or [] if not r.ok]


VARIABLES_SUPABASE = ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_EMAIL", "SUPABASE_PASSWORD")


def _crear_cliente_supabase() -> Any:
    """Inicia sesión en Supabase con tu usuario (como el sincronizador de
    estados de cuenta), traduciendo los problemas esperables."""
    faltantes = [v for v in VARIABLES_SUPABASE if not os.environ.get(v)]
    if faltantes:
        raise FaltaConfiguracionSupabase(
            f"Falta {', '.join(faltantes)} en tu .env: sin eso no se puede subir a Supabase "
            "(es la misma configuración que usa \"Sincronizar a Supabase...\")."
        )
    try:
        from sync.gastos_correo import crear_cliente

        return crear_cliente()
    except ImportError as error:
        raise FaltaConfiguracionSupabase(
            f"Falta la librería de Supabase ({error.name}): pip install -r requirements.txt"
        ) from error
    except Exception as error:  # noqa: BLE001 -- típicamente usuario/contraseña
        raise FaltaConfiguracionSupabase(
            f"No se pudo iniciar sesión en Supabase: {error}\n"
            "Revisa SUPABASE_EMAIL y SUPABASE_PASSWORD en tu .env."
        ) from error


def revisar_gmail(
    dias: int = 3,
    subir: bool = False,
    *,
    servicio: ServicioGmail | None = None,
    cliente_supabase: Any = None,
    reglas: list[Regla] | None = None,
    carpeta: Path = CARPETA_GASTOS_CORREO,
    permitir_autorizar: bool = True,
    progreso: Callable[[str, int | None, int | None], None] | None = None,
) -> ResultadoRevision:
    """Lee los avisos de los últimos `dias`, los guarda por día en `carpeta` y,
    con `subir`, sube la carpeta a Supabase. Equivale a
    `python -m sync.gmail_gastos --dias N [--subir]`.

    `servicio`/`cliente_supabase`/`reglas` se pueden inyectar (pruebas); si no,
    se construyen como en el CLI (Gmail real, tu sesión de Supabase del `.env`).
    `progreso(mensaje, hechos, total)` informa el avance (hechos/total None =
    paso sin cantidad). Los problemas esperables salen como `ErrorGastosGmail`.
    """

    def avisar(mensaje: str, hechos: int | None = None, total: int | None = None) -> None:
        if progreso:
            progreso(mensaje, hechos, total)

    # La sesión de Supabase se abre ANTES de leer Gmail: si falta configuración
    # o la contraseña está mal, mejor saberlo ya.
    if subir and cliente_supabase is None:
        avisar("Iniciando sesión en Supabase…")
        cliente_supabase = _crear_cliente_supabase()

    reglas = cargar_reglas() if reglas is None else reglas
    resultado = ResultadoRevision(dias=dias, sin_reglas=not reglas)

    if servicio is None:
        avisar("Conectando con Gmail…")
        servicio = crear_servicio_gmail(permitir_autorizar=permitir_autorizar)
    avisar("Buscando avisos de compra en Gmail…")
    try:
        avisos, ilegibles = leer_avisos(
            servicio, dias, lambda n, total: avisar(f"Leyendo correo {n} de {total}…", n, total)
        )
    except Exception as error:  # noqa: BLE001
        if _es_permiso_invalido(error):
            raise PermisoGmailInvalido(MENSAJE_PERMISO_INVALIDO) from error
        raise

    previos = ids_guardados(carpeta)
    por_dia = agrupar_por_dia(avisos, reglas, cargar_ciudades_extra(carpeta))
    escribir_dias(por_dia, carpeta)

    gastos = [g for gs in por_dia.values() for g in gs]
    resultado.avisos_leidos = len(avisos)
    resultado.nuevos = sum(1 for g in gastos if g["id"] not in previos)
    resultado.ilegibles = ilegibles
    resultado.por_dia = [
        ResumenDia(fecha, len(gs), sum((Decimal(str(g["monto"])) for g in gs), Decimal("0")))
        for fecha, gs in sorted(por_dia.items())
    ]
    resultado.sin_categoria = sorted({g["establecimiento"] for g in gastos if g["categoria"] == "Sin categoría"})
    resultado.codigos_sin_confirmar = sorted({g["ciudad_cod"] for g in gastos if "ciudad" not in g})

    if subir:
        from sync.gastos_correo import subir_todos

        avisar("Subiendo a Supabase…")
        try:
            resultado.subidas = subir_todos(cliente_supabase, carpeta)
        except ValueError as error:  # sin sesión
            raise FaltaConfiguracionSupabase(str(error)) from error
    return resultado


def resumen_revision(r: ResultadoRevision) -> str:
    """Una línea con los conteos, para la barra de estado de la app."""
    texto = f"{r.avisos_leidos} aviso(s) leído(s) en los últimos {r.dias} día(s), {r.nuevos} nuevo(s)"
    if r.subidas is not None:
        texto += f", {r.gastos_subidos} gasto(s) subido(s) a Supabase"
    return texto + "."


def avisos_para_mostrar(r: ResultadoRevision) -> list[str]:
    """Los problemas de una revisión, en español, uno por línea. Los
    establecimientos sin categoría van completos (con su código de ciudad) para
    poder copiarlos y escribir la regla."""
    lineas: list[str] = []
    for sub in r.subidas_fallidas:
        lineas.append(f"Error al subir {sub.archivo} a Supabase: {sub.error}")
    if r.ilegibles:
        lineas.append(
            f"{len(r.ilegibles)} correo(s) no se pudieron leer como cargo exitoso "
            f"(otro tipo de aviso o formato nuevo), ids: {', '.join(r.ilegibles)}"
        )
    if r.sin_reglas:
        lineas.append(
            "No hay reglas en transform/reglas_categorizacion.json: todo quedó \"Sin categoría\"."
        )
    if r.sin_categoria:
        lineas.append(f"Sin categoría ({len(r.sin_categoria)}), agrega una regla para cada uno:")
        lineas += [f"  {est}" for est in r.sin_categoria]
    if r.codigos_sin_confirmar:
        lineas.append(
            f"Códigos de ciudad sin confirmar: {', '.join(r.codigos_sin_confirmar)} "
            "(agrégalos en data/gastos_correo/ciudades.json, p. ej. {\"CIU\": \"Ciudad Apodaca\"})."
        )
    return lineas


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    ap = argparse.ArgumentParser(description="Lee los avisos de compra de Banamex en Gmail.")
    ap.add_argument("--dias", type=int, default=3, help="días hacia atrás a revisar (default 3)")
    ap.add_argument("--subir", action="store_true", help="después sube los archivos a Supabase")
    args = ap.parse_args()

    try:
        r = revisar_gmail(args.dias, args.subir)
    except ErrorGastosGmail as error:
        raise SystemExit(str(error)) from error

    if r.sin_reglas:
        print("Aviso: no hay reglas en transform/reglas_categorizacion.json; todo saldrá 'Sin categoría'.")
    for dia in r.por_dia:
        print(f"{dia.fecha}: {dia.gastos} gastos, total ${dia.total:,.2f}")
    for est in r.sin_categoria:
        print(f"Sin categoría: {est!r} -- agrega una regla en la app de escritorio.")
    if r.codigos_sin_confirmar:
        print(f"Códigos de ciudad sin confirmar: {', '.join(r.codigos_sin_confirmar)} (agrégalos en data/gastos_correo/ciudades.json).")
    if r.ilegibles:
        print(f"{len(r.ilegibles)} correos no se pudieron leer como cargo exitoso (ids): {', '.join(r.ilegibles)}")
    if not r.por_dia:
        print("No se encontraron cargos en la ventana.")
    for sub in r.subidas or []:
        print(f"{sub.archivo}: {sub.gastos_enviados} gastos -- {'OK' if sub.ok else 'ERROR: ' + (sub.error or '')}")


if __name__ == "__main__":
    main()
