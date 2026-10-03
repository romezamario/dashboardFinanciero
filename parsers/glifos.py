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

# Un grupo de hasta tantas imágenes con su propia base es puntuación
# desplazada, no un renglón (ver `_agrupar_en_renglones`); se une al renglón
# cuya base esté a lo más a esta distancia (los renglones van cada ~12 pt).
MAXIMO_GLIFOS_SUELTOS = 3
DISTANCIA_MAXIMA_SUELTOS = 6.0


def _huella(imagen: dict) -> str | None:
    if not imagen.get("imagemask"):
        return None
    ancho, alto = imagen["srcsize"]
    datos = imagen["stream"].get_data()
    return hashlib.sha1(f"{ancho}x{alto}".encode() + datos).hexdigest()[:16]


# Una pieza de un renglón, por posición: una letra-imagen o una palabra de
# texto. (x0, x1, texto, avance) -- `avance` solo en las letras-imagen.
_Pieza = tuple[float, float, str, float | None]


def _piezas_de_imagenes(imagenes: list[dict]) -> list[_Pieza] | None:
    """Una pieza por letra-imagen, o None si alguna no está en `GLIFOS`."""
    piezas: list[_Pieza] = []
    for imagen in imagenes:
        clave = _huella(imagen)
        if clave not in GLIFOS:
            return None
        caracter, avance = GLIFOS[clave]
        if clave == _CLAVE_I_O_L:
            caracter = _CLAVE_I_O_L  # se resuelve a "I"/"l" al unir (ver `_unir`)
        piezas.append((imagen["x0"], imagen["x0"] + avance, caracter, avance))
    return piezas


def _piezas_de_texto(linea: dict) -> list[_Pieza]:
    """Las palabras de una línea de `extract_text_lines()`, con su posición
    (sus `chars` no incluyen los espacios: una palabra termina donde hay
    hueco entre un carácter y el siguiente)."""
    piezas: list[_Pieza] = []
    actual: list[dict] = []
    for caracter in [*linea["chars"], None]:
        if actual and (caracter is None or caracter["x0"] - actual[-1]["x1"] > 1.0):
            if actual:
                piezas.append(
                    (actual[0]["x0"], actual[-1]["x1"], "".join(c["text"] for c in actual), None)
                )
            actual = []
        if caracter is not None and caracter["text"].strip():
            actual.append(caracter)
    return piezas


def _unir(piezas: list[_Pieza]) -> str:
    """Texto de un renglón a partir de sus piezas, ordenadas por x. Entre dos
    letras-imagen hay espacio si la segunda empieza más lejos que el avance
    normal de la primera; junto a una palabra de texto, siempre (el banco no
    parte una palabra entre texto e imagen, y el borde de la caja de una
    imagen no coincide con el de su letra, así que no sirve medir el hueco)."""
    texto: list[str] = []
    anterior: _Pieza | None = None
    for pieza in sorted(piezas, key=lambda p: p[0]):
        x0, _x1, contenido, avance = pieza
        if anterior is not None:
            if avance is None or anterior[3] is None:
                hay_espacio = True
            else:
                hay_espacio = x0 - anterior[0] > anterior[3] + UMBRAL_ESPACIO
            if hay_espacio:
                texto.append(" ")
        if contenido == _CLAVE_I_O_L:
            contenido = "l" if texto and texto[-1][-1:].islower() else "I"
        texto.append(contenido)
        anterior = pieza
    return "".join(texto)


def _agrupar_en_renglones(imagenes: list[dict]) -> list[list[dict]]:
    """Agrupa por la base de la caja de cada imagen (las letras de un renglón
    comparten `bottom`, con ±1 pt de diferencia). La caja de algunos signos
    ("$", ",", "-") puede quedar unos puntos más abajo y formar un grupito
    propio; esos grupos chicos se unen al renglón más cercano -- si no, un
    monto salía como "$00 000.00" sin coma, o sin su signo."""
    grupos: list[list[dict]] = []
    for imagen in sorted(imagenes, key=lambda i: i["bottom"]):
        if grupos and abs(imagen["bottom"] - grupos[-1][0]["bottom"]) <= 3:
            grupos[-1].append(imagen)
        else:
            grupos.append([imagen])

    grandes = [g for g in grupos if len(g) > MAXIMO_GLIFOS_SUELTOS]
    if grandes:
        for grupo in grupos:
            if len(grupo) > MAXIMO_GLIFOS_SUELTOS:
                continue
            destino = min(grandes, key=lambda g: abs(g[0]["bottom"] - grupo[0]["bottom"]))
            if abs(destino[0]["bottom"] - grupo[0]["bottom"]) <= DISTANCIA_MAXIMA_SUELTOS:
                destino.extend(grupo)
            else:
                grandes.append(grupo)
        grupos = sorted(grandes, key=lambda g: g[0]["bottom"])
    return [sorted(g, key=lambda i: i["x0"]) for g in grupos]


def completar_lineas_con_imagenes(
    pagina, texto: str, es_incompleta: Callable[[str], bool]
) -> list[str]:
    """Las líneas de `texto` (el `extract_text()` de `pagina`), con cada línea
    `es_incompleta` -- y el bloque que abre -- reconstruido juntando por
    posición sus palabras de texto y las letras-imagen de sus renglones.

    El bloque va desde esa línea hasta la siguiente línea de texto que empiece
    en el mismo margen izquierdo (la siguiente transacción); sus líneas de
    detalle van más a la derecha. Hay bloques donde TODO es imagen menos las
    fechas (un "SU ABONO...GRACIAS"), y otros donde las etiquetas y el monto
    son imagen pero los valores son texto, en el mismo renglón (un PAGO
    INTERBANCARIO: "CLAVE DE RASTREO:" imagen, la clave texto). Si el renglón
    de las fechas no se puede leer completo, el bloque queda tal cual."""
    lineas = texto.splitlines()
    if not pagina.images or not any(es_incompleta(l.strip()) for l in lineas):
        return lineas
    # Mismas líneas que extract_text(), pero con posición (verificado igual en
    # las 1,215 páginas de los PDFs reales); si alguna vez no, no se toca nada.
    posiciones = pagina.extract_text_lines()
    if [p["text"] for p in posiciones] != lineas:
        return lineas

    letras = [i for i in pagina.images if i.get("imagemask")]
    resultado: list[str] = []
    n = 0
    while n < len(posiciones):
        inicio = posiciones[n]
        if not es_incompleta(inicio["text"].strip()):
            resultado.append(inicio["text"])
            n += 1
            continue
        fin = n + 1
        while fin < len(posiciones) and posiciones[fin]["x0"] > inicio["x0"] + 5:
            fin += 1
        limite = posiciones[fin]["top"] if fin < len(posiciones) else pagina.height
        zona = [i for i in letras if i["bottom"] > inicio["top"] and i["top"] < limite]
        reconstruido = _reconstruir_bloque(posiciones[n:fin], zona)
        resultado.extend(reconstruido or [p["text"] for p in posiciones[n:fin]])
        n = fin
    return resultado


def _centro(caja: dict) -> float:
    return (caja["top"] + caja["bottom"]) / 2


def _reconstruir_bloque(lineas: list[dict], imagenes: list[dict]) -> list[str] | None:
    """Renglones del bloque, de arriba abajo; None si el primero (el de las
    fechas) no tiene letras-imagen legibles."""
    # (centro vertical, piezas) por renglón; las líneas de texto primero.
    renglones: list[tuple[float, list[_Pieza]]] = [
        (_centro(l), _piezas_de_texto(l)) for l in lineas
    ]
    solo_imagenes: list[tuple[float, list[_Pieza]]] = []
    for grupo in _agrupar_en_renglones(imagenes):
        piezas = _piezas_de_imagenes(grupo)
        centro = _centro(grupo[0])
        # La caja de cada imagen es más alta que la letra: el renglón de
        # texto que le corresponde es el de centro más cercano.
        cercano = min(renglones, key=lambda r: abs(r[0] - centro))
        if abs(cercano[0] - centro) <= 5:
            if piezas is None:
                if cercano is renglones[0]:
                    return None
                continue  # se queda solo con su texto
            cercano[1].extend(piezas)
        elif piezas is not None and centro > renglones[0][0]:
            solo_imagenes.append((centro, piezas))

    if len(renglones[0][1]) == len(_piezas_de_texto(lineas[0])):
        return None  # el renglón de las fechas no ganó nada

    # Renglones solo-imagen (sin texto): solo mientras sigan pegados al bloque,
    # para no arrastrar el pie de página.
    todos = sorted(renglones, key=lambda r: r[0])
    for centro, piezas in sorted(solo_imagenes):
        if centro - todos[-1][0] > SEPARACION_MAXIMA_RENGLONES and centro > todos[-1][0]:
            break
        todos.append((centro, piezas))
        todos.sort(key=lambda r: r[0])
    return [_unir(piezas) for _centro_renglon, piezas in todos if piezas]
