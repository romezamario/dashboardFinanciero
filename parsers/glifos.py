"""Lectura de renglones que el PDF imprime como IMÁGENES de letras en vez de
texto seleccionable.

Confirmado 2026-10-02 contra los estados de cuenta reales de TDC Banamex: las
filas destacadas (el "SU ABONO...GRACIAS" de un pago recibido, y bloques de
varias líneas como un PAGO INTERBANCARIO) no traen texto -- cada carácter es
una imagen-máscara de 1 bit propia, colocada en la posición donde iría la
letra. `extract_text()` solo ve las dos fechas del renglón (que sí son texto),
por eso esas filas salían como "posible transacción no capturada".

No hace falta OCR: el banco usa siempre el mismo bitmap para el mismo
carácter (en 144 PDFs, 7,585 imágenes de letra en esas filas = solo 66 bitmaps
distintos), así que basta un diccionario huella-del-bitmap -> carácter
(`GLIFOS`). Los espacios no son imágenes: se deducen de la distancia entre una
letra y la siguiente, comparada contra el avance normal de esa letra (medido
en los mismos PDFs; las posiciones vienen cuantizadas a 0.3 pt, de ahí el
margen `UMBRAL_ESPACIO`).

Conservador a propósito: si una fila trae un bitmap que no está en `GLIFOS`
(una letra nunca vista, p. ej. "Ñ" o "Q" minúscula), esa fila NO se completa
-- el extractor sigue reportándola como advertencia, igual que antes, en vez
de adivinar. Para agregar un carácter nuevo: su huella sale de `_huella()`.
"""

from __future__ import annotations

import hashlib
from typing import Callable

# huella -> (carácter, avance sin espacio en pt). "I" e "l" son el MISMO
# bitmap en esta fuente; ver `_CLAVE_I_O_L`.
GLIFOS: dict[str, tuple[str, float]] = {
    "0dbc3782669656f8": ('#', 4.6),
    "38f71c179b9b777b": ('$', 4.5),
    "4312839ea3bff36b": ("'", 2.0),
    "bd90999555ce4a23": ('(', 2.7),
    "1c208de8de4f3990": (')', 2.8),
    "c09ca868779c33e4": ('*', 3.2),
    "86e179cb8b550c5e": ('+', 6.6),
    "533de241f6ce0578": (',', 2.1),
    "4b21b0c2c06b024a": ('-', 2.4),
    "21e25b0a1ae814b7": ('.', 2.1),
    "ba72b824e08578f5": ('0', 4.2),
    "27185c55a551e107": ('1', 3.9),
    "b9693244e97fa64d": ('2', 4.2),
    "cbbf454f28062a8d": ('3', 4.2),
    "0aa9441160fcb702": ('4', 4.8),
    "0d9246028eb36bf8": ('5', 4.5),
    "29e656163ede2eaa": ('6', 4.2),
    "e9cc3d84bce8e722": ('7', 4.2),
    "aa8caf87dc63ae67": ('8', 4.2),
    "665267f50329bdbc": ('9', 4.2),
    "18d6d6de9f8c7cdb": (':', 2.1),
    "3eebfa85fa274a16": ('A', 6.0),
    "cf717a596b35dee4": ('B', 5.4),
    "ee7d30dd11159a12": ('C', 5.7),
    "d53caa52a54fdcca": ('D', 5.7),
    "46d7607c0a74dc11": ('E', 4.8),
    "01382396a94cb450": ('F', 4.8),
    "942c2582d7187d6e": ('G', 6.3),
    "09f42d03cc59540e": ('H', 5.4),
    "0736a5928b2b39b3": ('I', 2.1),
    "14cfb4d54cc5fad6": ('J', 4.8),
    "59e66b74b3a6772c": ('K', 5.7),
    "c6ba9f036a1f3b5d": ('L', 4.8),
    "84538ca58e39b7a7": ('M', 6.9),
    "6df959372034ef92": ('N', 5.4),
    "b013adf95036fdfe": ('O', 6.3),
    "107dc6bd20b44e86": ('P', 5.1),
    "dd4a81283be22b0b": ('Q', 6.3),
    "21b1721a4c49348a": ('R', 5.7),
    "a781caac9f5ce285": ('S', 5.4),
    "adfc3a3ce6450559": ('T', 4.8),
    "63c52c3c3394ad37": ('U', 5.7),
    "3e847824f4960044": ('V', 6.0),
    "8493673e52d454c1": ('W', 8.1),
    "687af7f653233469": ('X', 5.7),
    "f40e3dfd2e3545b7": ('Y', 5.7),
    "f0e64191e3ebbf26": ('Z', 4.8),
    "0c796b309cb82f10": ('a', 4.8),
    "5a44c48d8f4afd65": ('b', 4.5),
    "94bf956e16b21252": ('c', 4.5),
    "affcf3626eb1de2f": ('d', 4.8),
    "7d39b76824980e1e": ('e', 4.5),
    "cc884a9dd8d91787": ('g', 4.8),
    "d59adba68a21d042": ('h', 4.5),
    "9b23ae229343d981": ('i', 2.1),
    "bea9f38406068147": ('j', 3.0),
    "8fa24a5472d80097": ('m', 6.9),
    "3ab26e35f318d90e": ('n', 4.2),
    "c6e3505e45042954": ('o', 4.8),
    "fd852b42cecf40b0": ('p', 4.5),
    "9958dea0c521b64b": ('r', 3.0),
    "0912dd2ca225831d": ('s', 4.5),
    "53a39ac7ee63f54d": ('t', 2.7),
    "2e354f6a41ef4dd7": ('v', 4.8),
    "9900c5d0371b2da0": ('Ó', 6.3),
    "cb4329d8a11e4bb2": ('ó', 5.1),
}

_CLAVE_I_O_L = "0736a5928b2b39b3"

# Un espacio agrega ~2.1-2.4 pt al avance; las variaciones sin espacio no
# pasan de ~0.6 pt (posiciones cuantizadas a 0.3 pt).
UMBRAL_ESPACIO = 1.1

# Cuánto puede separarse verticalmente un renglón de imágenes del anterior
# para seguir contando como continuación del mismo bloque (las líneas de un
# bloque van cada ~12 pt; el pie de página queda mucho más lejos).
SEPARACION_MAXIMA_RENGLONES = 20.0


def _huella(imagen: dict) -> str | None:
    if not imagen.get("imagemask"):
        return None
    ancho, alto = imagen["srcsize"]
    datos = imagen["stream"].get_data()
    return hashlib.sha1(f"{ancho}x{alto}".encode() + datos).hexdigest()[:16]


def _decodificar_renglon(imagenes: list[dict]) -> str | None:
    """Texto de un renglón de imágenes-letra (ya ordenadas por x), o None si
    alguna no está en `GLIFOS`."""
    texto: list[str] = []
    anterior: tuple[float, float] | None = None  # (x0, avance)
    for imagen in imagenes:
        clave = _huella(imagen)
        if clave not in GLIFOS:
            return None
        caracter, avance = GLIFOS[clave]
        if anterior is not None and imagen["x0"] - anterior[0] > anterior[1] + UMBRAL_ESPACIO:
            texto.append(" ")
        if clave == _CLAVE_I_O_L and texto and texto[-1].islower():
            caracter = "l"
        texto.append(caracter)
        anterior = (imagen["x0"], avance)
    return "".join(texto)


def _agrupar_en_renglones(imagenes: list[dict]) -> list[list[dict]]:
    """Agrupa por la base de la caja de cada imagen (todas las letras de un
    renglón comparten `bottom`, con ±1 pt de diferencia)."""
    renglones: list[list[dict]] = []
    for imagen in sorted(imagenes, key=lambda i: i["bottom"]):
        if renglones and abs(imagen["bottom"] - renglones[-1][0]["bottom"]) <= 3:
            renglones[-1].append(imagen)
        else:
            renglones.append([imagen])
    return [sorted(r, key=lambda i: i["x0"]) for r in renglones]


def completar_lineas_con_imagenes(
    pagina, texto: str, es_incompleta: Callable[[str], bool]
) -> list[str]:
    """Las líneas de `texto` (el `extract_text()` de `pagina`), con cada línea
    `es_incompleta` completada con el texto de las imágenes-letra de su mismo
    renglón, y seguida de los renglones de imágenes que vienen justo debajo
    (continuación de un bloque de varias líneas) hasta la siguiente línea de
    texto. Si algo no cuadra, devuelve las líneas tal cual."""
    lineas = texto.splitlines()
    if not pagina.images or not any(es_incompleta(l.strip()) for l in lineas):
        return lineas

    # extract_text_lines() da las mismas líneas que extract_text() pero con
    # posición; se emparejan por texto y orden de aparición.
    posiciones = pagina.extract_text_lines()
    por_texto: dict[str, list[dict]] = {}
    for posicion in posiciones:
        por_texto.setdefault(posicion["text"].strip(), []).append(posicion)

    letras = [i for i in pagina.images if i.get("imagemask")]
    resultado: list[str] = []
    for linea in lineas:
        resultado.append(linea)
        limpia = linea.strip()
        if not es_incompleta(limpia) or not por_texto.get(limpia):
            continue
        posicion = por_texto[limpia].pop(0)
        siguientes = [p["top"] for p in posiciones if p["top"] > posicion["bottom"]]
        limite = min(siguientes, default=pagina.height)
        zona = [
            i for i in letras
            if i["bottom"] > posicion["top"] and i["top"] < limite
        ]
        renglones = _agrupar_en_renglones(zona)
        if not renglones:
            continue
        # La caja de cada imagen es más alta que la letra, así que la zona
        # puede incluir el renglón de imágenes de ARRIBA: el de las fechas es
        # el de centro vertical más cercano al de la línea de texto.
        centro = (posicion["top"] + posicion["bottom"]) / 2
        indice = min(
            range(len(renglones)),
            key=lambda n: abs((renglones[n][0]["top"] + renglones[n][0]["bottom"]) / 2 - centro),
        )
        if not (renglones[indice][0]["top"] <= posicion["bottom"]
                and renglones[indice][0]["bottom"] >= posicion["top"]):
            continue
        primero = _decodificar_renglon(renglones[indice])
        if primero is None:
            continue
        resultado[-1] = f"{limpia} {primero}"
        base_anterior = renglones[indice][0]["bottom"]
        for renglon in renglones[indice + 1:]:
            if renglon[0]["bottom"] - base_anterior > SEPARACION_MAXIMA_RENGLONES:
                break
            decodificado = _decodificar_renglon(renglon)
            if decodificado is None:
                break
            resultado.append(decodificado)
            base_anterior = renglon[0]["bottom"]
    return resultado
