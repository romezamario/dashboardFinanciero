"""Propuestas de reglas de categorización hechas por Claude.

En vez de copiar la pestaña "Sin categorizar" y pegarla en un chat, la app le
pregunta directamente a Claude Code (`claude -p`, la CLI en modo no
interactivo), que usa la suscripción del usuario: sin API key ni costo extra.
Lo único que sale de la laptop son las descripciones sin categoría (lo mismo
que ya se pegaba en el chat) y las reglas actuales, como ejemplo del estilo;
nunca el PDF ni su texto crudo.

Claude solo PROPONE: la app muestra cada propuesta y el usuario elige cuáles
se vuelven reglas (`VentanaSugerenciasIA`). Sin tkinter aquí, para poder
probarlo sin pantalla (tests/test_sugerencias_ia.py).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from transform.categorizador import Regla

# Un patrón más corto que esto atraparía demasiadas descripciones ("BAR", "OXX").
MINIMO_CARACTERES_PATRON = 4
# Lo que puede tardar Claude en contestar una lista larga (p. ej. un viaje).
TIEMPO_MAXIMO_SEGUNDOS = 600

INSTRUCCIONES = """\
Eres el asistente de categorización de gastos de un usuario en México. Te paso
descripciones de movimientos de sus estados de cuenta (tarjetas Banamex e Invex)
que ninguna regla categorizó. Para cada una propón una regla.

Cómo funcionan las reglas: si `patron` aparece dentro de la descripción (sin
importar mayúsculas), se asignan `categoria` y `comercio`. Gana la primera que
coincide; tus reglas se agregan al final, así que solo afectan movimientos que
hoy no tienen categoría.

Criterios (los mismos que el usuario ya acordó):
- `patron`: un fragmento que aparezca LITERALMENTE en la descripción y que
  identifique al comercio: su nombre o su RFC (p. ej. "OPP 010927SA5"). Nada de
  palabras genéricas ("RESTAURANTE", "MEXICO"), ciudades, números de sucursal o
  de referencia que cambian en cada compra. Mínimo 4 caracteres.
- `categoria`: usa una de las categorías existentes; solo inventa una nueva si
  ninguna encaja.
- `comercio`: el nombre comercial legible ("Domino's Pizza", no "DP 11525").
  En movimientos del banco (comisiones, intereses, pagos, transferencias)
  repite la categoría como comercio, salvo "Domiciliación". Si aparece GBM, el
  comercio es "GBM".
- Si NO sabes qué comercio es, NO adivines: deja `categoria` y `comercio` en
  null y explica en `nota` qué parece ser (p. ej. "cobro con terminal Mercado
  Pago, comercio desconocido"). El usuario prefiere que preguntes a que inventes.
- `confianza`: "alta", "media" o "baja".
- `nota`: una frase corta en español con tu razonamiento (p. ej. "DP = Domino's
  Pizza; el RFC es de su operadora").

Responde SOLO con un arreglo JSON, sin texto antes ni después, un objeto por
descripción y en el mismo orden:
[{"descripcion": "...", "patron": "...", "categoria": "...", "comercio": "...",
  "confianza": "alta", "nota": "..."}]
"""


class ErrorSugerenciasIA(Exception):
    """Problema esperado, con un mensaje en español listo para mostrar."""


@dataclass
class Sugerencia:
    descripcion: str
    patron: str
    categoria: str | None
    comercio: str | None
    confianza: str
    nota: str
    # Por qué no conviene aceptarla tal cual (vacío = se puede aceptar).
    problema: str = ""
    # Otras descripciones sin categoría que la regla también atraparía.
    tambien_aplica_a: tuple[str, ...] = ()

    @property
    def aceptable(self) -> bool:
        return not self.problema


def construir_prompt(descripciones: list[str], reglas: list[Regla]) -> str:
    categorias = sorted({r.categoria for r in reglas})
    ejemplos = "\n".join(
        f"{r.patron} → {r.categoria}" + (f" | {r.comercio}" if r.comercio else "")
        for r in reglas
    )
    pendientes = "\n".join(descripciones)
    return (
        f"{INSTRUCCIONES}\n"
        f"## Categorías existentes\n{chr(10).join(categorias) or '(ninguna todavía)'}\n\n"
        f"## Reglas actuales (patrón → categoría | comercio), como ejemplo del estilo\n"
        f"{ejemplos or '(ninguna todavía)'}\n\n"
        f"## Descripciones sin categoría\n{pendientes}\n"
    )


def buscar_claude() -> str | None:
    """Ruta del ejecutable de Claude Code, o None. Además del PATH revisa
    dónde lo dejan el instalador oficial y npm: la app se abre con un acceso
    directo, que no siempre hereda el PATH de una consola."""
    encontrado = shutil.which("claude")
    if encontrado:
        return encontrado
    inicio = Path.home()
    candidatos = [
        inicio / ".local" / "bin" / "claude.exe",
        inicio / ".local" / "bin" / "claude",
        Path(os.environ.get("APPDATA", inicio)) / "npm" / "claude.cmd",
    ]
    return next((str(c) for c in candidatos if c.is_file()), None)


def _ejecutar_claude(prompt: str) -> str:
    ejecutable = buscar_claude()
    if ejecutable is None:
        raise ErrorSugerenciasIA(
            "No encontré Claude Code (el comando `claude`). Instálalo una vez desde "
            "una consola:\n\n    npm install -g @anthropic-ai/claude-code\n\n"
            "y luego corre `claude` una vez para iniciar sesión con tu cuenta. "
            "Después vuelve a intentarlo."
        )
    try:
        proceso = subprocess.run(
            [ejecutable, "-p", "--output-format", "json"],
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=TIEMPO_MAXIMO_SEGUNDOS,
            # Fuera del repo: así no carga el CLAUDE.md del proyecto (enorme e
            # irrelevante para esto) ni puede tocar sus archivos.
            cwd=tempfile.gettempdir(),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0,
        )
    except subprocess.TimeoutExpired as error:
        raise ErrorSugerenciasIA(
            f"Claude no contestó en {TIEMPO_MAXIMO_SEGUNDOS // 60} minutos. "
            "Intenta con menos descripciones o más tarde."
        ) from error
    except OSError as error:
        raise ErrorSugerenciasIA(f"No se pudo ejecutar Claude Code: {error}") from error

    try:
        salida = json.loads(proceso.stdout)
    except ValueError:
        detalle = (proceso.stderr or proceso.stdout).strip()[:600]
        raise ErrorSugerenciasIA(
            "Claude Code no devolvió una respuesta válida. Si nunca has iniciado "
            "sesión, corre `claude` una vez en una consola.\n\n" + detalle
        ) from None
    if salida.get("is_error"):
        raise ErrorSugerenciasIA(f"Claude Code respondió con un error:\n\n{salida.get('result', '')}")
    return str(salida.get("result", ""))


def _extraer_arreglo(texto: str) -> list[dict]:
    """El arreglo JSON de la respuesta, aunque venga dentro de ```json ... ```
    o con alguna frase alrededor."""
    inicio, fin = texto.find("["), texto.rfind("]")
    if inicio == -1 or fin < inicio:
        raise ErrorSugerenciasIA("La respuesta de Claude no trae la lista de propuestas.")
    try:
        datos = json.loads(texto[inicio : fin + 1])
    except ValueError as error:
        raise ErrorSugerenciasIA(f"No se pudo leer la respuesta de Claude: {error}") from error
    if not isinstance(datos, list):
        raise ErrorSugerenciasIA("La respuesta de Claude no es una lista.")
    return [d for d in datos if isinstance(d, dict)]


def _texto(valor) -> str | None:
    if valor is None:
        return None
    valor = str(valor).strip()
    return valor or None


def revisar_sugerencias(
    crudas: list[dict], descripciones: list[str], reglas: list[Regla]
) -> list[Sugerencia]:
    """Convierte la respuesta en `Sugerencia`s, una por descripción pedida (en
    su orden), y marca las que no conviene aceptar tal cual."""
    por_descripcion = {}
    for d in crudas:
        clave = _texto(d.get("descripcion"))
        if clave and clave.upper() not in por_descripcion:
            por_descripcion[clave.upper()] = d
    patrones_existentes = {r.patron.upper() for r in reglas}

    sugerencias = []
    patrones_propuestos: set[str] = set()
    for descripcion in descripciones:
        d = por_descripcion.get(descripcion.strip().upper(), {})
        patron = _texto(d.get("patron")) or ""
        s = Sugerencia(
            descripcion=descripcion,
            patron=patron,
            categoria=_texto(d.get("categoria")),
            comercio=_texto(d.get("comercio")),
            confianza=_texto(d.get("confianza")) or "",
            nota=_texto(d.get("nota")) or ("" if d else "Claude no la incluyó en su respuesta."),
        )
        s.problema = problema_de(s, patrones_existentes | patrones_propuestos)
        if s.aceptable:
            patrones_propuestos.add(patron.upper())
        s.tambien_aplica_a = tuple(
            otra for otra in descripciones
            if otra != descripcion and patron and patron.upper() in otra.upper()
        )
        sugerencias.append(s)
    return sugerencias


def problema_de(s: Sugerencia, patrones_ya_usados: set[str] = frozenset()) -> str:
    """Por qué esta propuesta no se puede aceptar tal cual ("" = se puede).
    También se usa al editar una fila en la ventana."""
    if not s.categoria:
        return "Claude no conoce el comercio"
    if not s.patron:
        return "sin patrón"
    if s.patron.upper() not in s.descripcion.upper():
        return "el patrón no aparece en la descripción"
    if len(s.patron) < MINIMO_CARACTERES_PATRON:
        return f"patrón de menos de {MINIMO_CARACTERES_PATRON} caracteres"
    if s.patron.upper() in patrones_ya_usados:
        return "ya existe una regla con ese patrón"
    return ""


def pedir_sugerencias(
    descripciones: list[str],
    reglas: list[Regla],
    ejecutar: Callable[[str], str] = _ejecutar_claude,
) -> list[Sugerencia]:
    """Pregunta a Claude por `descripciones` (únicas, sin categoría). `ejecutar`
    recibe el prompt y devuelve el texto de la respuesta (en pruebas, un falso)."""
    if not descripciones:
        return []
    texto = ejecutar(construir_prompt(descripciones, reglas))
    return revisar_sugerencias(_extraer_arreglo(texto), descripciones, reglas)
