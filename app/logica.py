"""Lógica de la app de escritorio que no toca la interfaz.

Separada de `app/main.py` para dos cosas: poder correrla en un hilo aparte
(Tkinter no es seguro entre hilos, ver app/hilos.py) y poder probarla sin
abrir ventanas (tests/test_logica_app.py).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from parsers.base import BaseParser
from parsers.comun import olvidar_textos_iniciales
from transform.categorizador import Regla, categorizar
from transform.transformador import (
    TransaccionCanonica,
    descartar_ya_capturadas_a_mano,
    transformar_renglones,
)

# Prefijo de `linea_cruda` de un renglón capturado a mano (VentanaRenglonManual):
# lo distingue de una línea real del PDF, y permite recuperarlo al recargar el
# mismo PDF (`recuperar_renglones_manuales`).
PREFIJO_RENGLON_MANUAL = "(manual) "

# Llave de una categoría puesta a mano: (pagina, linea_cruda), la del upsert.
LlaveRenglon = tuple[int, str]


def hash_pdf(ruta: Path) -> str:
    return hashlib.sha256(ruta.read_bytes()).hexdigest()


def es_renglon_manual(t: TransaccionCanonica) -> bool:
    return t.linea_cruda.startswith(PREFIJO_RENGLON_MANUAL)


def detectar_banco(ruta_pdf: Path, parsers: dict[str, type[BaseParser]]) -> str | None:
    """Prueba cada extractor registrado contra el PDF. Si exactamente uno dice
    que puede procesarlo, ese es el banco -- evita que el usuario tenga que
    elegirlo a mano. Ambigüedad (0 o 2+ coincidencias) devuelve None y la app
    se queda con lo que esté seleccionado en la lista."""
    coincidencias = []
    for nombre, parser_cls in parsers.items():
        try:
            if parser_cls().puede_procesar(ruta_pdf):
                coincidencias.append(nombre)
        except Exception:  # noqa: BLE001 — un extractor roto no debe tumbar la detección
            continue
    return coincidencias[0] if len(coincidencias) == 1 else None


def crear_parser(parser_cls: type[BaseParser], anio_respaldo: str) -> BaseParser:
    """Algunos extractores necesitan el año (el PDF no lo trae impreso en cada
    renglón); otros no aceptan ese argumento."""
    try:
        return parser_cls(ano_estado_de_cuenta=anio_respaldo)  # type: ignore[call-arg]
    except TypeError:
        return parser_cls()


def recuperar_renglones_manuales(
    ruta_json: Path, reglas: list[Regla], origen: str
) -> list[TransaccionCanonica]:
    """Renglones capturados a mano (VentanaRenglonManual) en una carga anterior
    del mismo PDF, leídos de su data/procesados/<hash>.json.

    El extractor solo vuelve a producir lo que puede leer del PDF, así que sin
    esto recargar un estado de cuenta (p. ej. para recategorizar tras cambiar
    una regla) y volver a guardarlo perdía en silencio los renglones manuales
    -- justo los que el usuario tuvo que teclear porque el PDF no los traía
    legibles. Se reconocen por el prefijo "(manual) " de su `linea_cruda` y se
    recategorizan con las reglas actuales, igual que las filas extraídas.
    Cualquier problema leyendo el JSON anterior se ignora: en el peor caso no
    se recupera nada."""
    if not ruta_json.exists():
        return []
    try:
        datos = json.loads(ruta_json.read_text(encoding="utf-8"))
        recuperados = []
        for t in datos.get("transacciones", []):
            if not str(t.get("linea_cruda", "")).startswith(PREFIJO_RENGLON_MANUAL):
                continue
            categoria, comercio = categorizar(t["descripcion"], reglas)
            if categoria is None:
                # Ninguna regla aplica: se conserva lo que el usuario
                # eligió/infirió en el diálogo (ya no es solo por reglas).
                categoria, comercio = t.get("categoria"), t.get("comercio")
            recuperados.append(
                TransaccionCanonica(
                    fecha=date.fromisoformat(t["fecha"]),
                    descripcion=t["descripcion"],
                    monto=Decimal(t["monto"]),
                    tipo=t["tipo"],
                    pagina=int(t["pagina"]),
                    linea_cruda=t["linea_cruda"],
                    moneda=t.get("moneda", "MXN"),
                    categoria=categoria,
                    comercio=comercio,
                    tarjeta=t.get("tarjeta"),
                    origen=origen,
                )
            )
        return recuperados
    except (OSError, ValueError, KeyError, InvalidOperation):
        return []


def recuperar_categorias_manuales(ruta_json: Path) -> dict[LlaveRenglon, tuple[str, str | None]]:
    """Las categorías puestas a mano en una carga anterior del mismo PDF
    (marcadas `categoria_manual` en su data/procesados/<hash>.json). Cualquier
    problema leyendo el JSON se ignora (no se recupera nada)."""
    try:
        datos = json.loads(ruta_json.read_text(encoding="utf-8"))
        return {
            (int(t["pagina"]), t["linea_cruda"]): (t["categoria"], t.get("comercio"))
            for t in datos.get("transacciones", [])
            if t.get("categoria_manual") and t.get("categoria")
        }
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def aplicar_categorias_manuales(
    transacciones: list[TransaccionCanonica],
    categorias_manuales: dict[LlaveRenglon, tuple[str, str | None]],
) -> list[TransaccionCanonica]:
    resultado = []
    for t in transacciones:
        manual = categorias_manuales.get((t.pagina, t.linea_cruda))
        resultado.append(replace(t, categoria=manual[0], comercio=manual[1]) if manual else t)
    return resultado


def mover_a_procesados_junto_al_pdf(ruta_pdf: Path) -> Path:
    """Mueve el PDF ya guardado a una subcarpeta "procesados" dentro de la
    misma carpeta donde estaba (no la carpeta data/procesados/ del proyecto,
    esa es para los JSON exportados) -- para llevar registro de qué estados de
    cuenta ya se cargaron sin tener que abrir cada JSON. Reutiliza la carpeta
    si ya existe. Devuelve la ruta nueva (o la misma, si no se pudo mover)."""
    if ruta_pdf.parent.name == "procesados":
        # Ya está adentro de una carpeta "procesados" (ej. lo volviste a
        # cargar desde ahí para corregir algo) -- no lo anides de nuevo.
        return ruta_pdf

    carpeta_destino = ruta_pdf.parent / "procesados"
    try:
        carpeta_destino.mkdir(exist_ok=True)
    except OSError:
        return ruta_pdf  # sin permisos u otra falla -- se queda donde estaba

    destino = carpeta_destino / ruta_pdf.name
    if destino.exists() and destino != ruta_pdf:
        # No pisar un archivo distinto que ya tenga ese nombre ahí.
        contador = 1
        while destino.exists():
            destino = carpeta_destino / f"{ruta_pdf.stem} ({contador}){ruta_pdf.suffix}"
            contador += 1

    try:
        return ruta_pdf.replace(destino)
    except OSError:
        return ruta_pdf


class ErrorDeExtraccion(Exception):
    """El extractor del banco no pudo leer el PDF."""

    def __init__(self, banco: str, error: Exception) -> None:
        super().__init__(str(error))
        self.banco = banco


@dataclass
class LecturaPdf:
    """Todo lo que deja `leer_estado_de_cuenta`, listo para mostrar."""

    ruta_pdf: Path
    banco: str
    banco_detectado: bool
    parser: BaseParser
    alias_detectado: str | None
    ultimos_4_detectados: str | None
    anio_detectado: str | None
    advertencias: list[str]
    # (fecha ISO, página, tarjeta) de cada fila que el extractor marcó como faltante.
    sugerencias_manuales: list[tuple[str, int | None, str | None]]
    transacciones: list[TransaccionCanonica] = field(default_factory=list)
    # (renglón, error) de lo que no se pudo normalizar.
    fallidas: list = field(default_factory=list)
    categorias_manuales: dict[LlaveRenglon, tuple[str, str | None]] = field(default_factory=dict)
    manuales_recuperados: int = 0
    ya_capturadas: int = 0
    hay_renglones: bool = False


def leer_estado_de_cuenta(
    ruta_pdf: Path,
    banco_manual: str,
    reglas: list[Regla],
    parsers: dict[str, type[BaseParser]],
    carpeta_procesados: Path,
    hoy: datetime | None = None,
) -> LecturaPdf:
    """Detecta el banco, extrae, normaliza y categoriza un PDF, y recupera lo
    que se haya hecho a mano en una carga anterior del mismo PDF. Sin
    widgets: corre en un hilo aparte mientras la ventana sigue respondiendo.
    Lanza `ErrorDeExtraccion` si el extractor no puede leer el PDF.

    El texto de las primeras páginas que comparten detección y lectura de la
    cuenta se olvida al terminar (ver `parsers.comun.textos_iniciales`)."""
    try:
        return _leer_estado_de_cuenta(ruta_pdf, banco_manual, reglas, parsers, carpeta_procesados, hoy)
    finally:
        olvidar_textos_iniciales()


def _leer_estado_de_cuenta(
    ruta_pdf: Path,
    banco_manual: str,
    reglas: list[Regla],
    parsers: dict[str, type[BaseParser]],
    carpeta_procesados: Path,
    hoy: datetime | None,
) -> LecturaPdf:
    banco_detectado = detectar_banco(ruta_pdf, parsers)
    banco = banco_detectado or banco_manual

    # Respaldo si un extractor necesita año y no lo puede detectar solo del
    # PDF -- no hay campo manual en la UI para esto (ver
    # BanamexParser._detectar_anio: el PDF es la fuente de verdad y la
    # sobreescribe de todos modos cuando la detección funciona).
    anio_respaldo = str((hoy or datetime.now()).year)
    parser = crear_parser(parsers[banco], anio_respaldo)
    try:
        renglones = parser.extraer(ruta_pdf)
    except Exception as error:  # noqa: BLE001 — se le muestra tal cual al usuario
        raise ErrorDeExtraccion(banco, error) from error

    anio_usado = getattr(parser, "ano_estado_de_cuenta", None)
    formato_fecha = getattr(parser, "formato_fecha", "%d/%m/%Y")

    try:
        alias_detectado, ultimos_4_detectados = parser.extraer_info_cuenta(ruta_pdf)
    except Exception:  # noqa: BLE001 — nunca debe tumbar la carga de transacciones
        alias_detectado, ultimos_4_detectados = None, None

    try:
        advertencias = parser.advertencias()
    except Exception:  # noqa: BLE001 — nunca debe tumbar la carga de transacciones
        advertencias = []

    sugerencias: list[tuple[str, int | None, str | None]] = []
    try:
        for sugerencia in parser.sugerencias_renglon_manual():
            if sugerencia.fecha_texto is None:
                continue
            try:
                fecha_iso = datetime.strptime(sugerencia.fecha_texto, formato_fecha).date().isoformat()
            except ValueError:
                continue
            sugerencias.append((fecha_iso, sugerencia.pagina, sugerencia.tarjeta))
    except Exception:  # noqa: BLE001 — nunca debe tumbar la carga de transacciones
        sugerencias = []

    lectura = LecturaPdf(
        ruta_pdf=ruta_pdf,
        banco=banco,
        banco_detectado=banco_detectado is not None,
        parser=parser,
        alias_detectado=alias_detectado,
        ultimos_4_detectados=ultimos_4_detectados,
        anio_detectado=anio_usado if anio_usado and anio_usado != anio_respaldo else None,
        advertencias=advertencias,
        sugerencias_manuales=sugerencias,
        hay_renglones=bool(renglones),
    )
    if not renglones:
        return lectura

    transacciones, lectura.fallidas = transformar_renglones(renglones, formato_fecha)
    categorizadas = []
    for t in transacciones:
        categoria, comercio = categorizar(t.descripcion, reglas)
        categorizadas.append(replace(t, categoria=categoria, comercio=comercio, origen=ruta_pdf.name))
    transacciones = categorizadas

    ruta_json = carpeta_procesados / f"{hash_pdf(ruta_pdf)}.json"
    lectura.categorias_manuales = recuperar_categorias_manuales(ruta_json)
    transacciones = aplicar_categorias_manuales(transacciones, lectura.categorias_manuales)
    manuales = recuperar_renglones_manuales(ruta_json, reglas, ruta_pdf.name)
    transacciones, lectura.ya_capturadas = descartar_ya_capturadas_a_mano(transacciones, manuales)
    lectura.transacciones = [*transacciones, *manuales]
    lectura.manuales_recuperados = len(manuales)
    return lectura
