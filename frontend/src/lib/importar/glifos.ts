// Filas que el PDF imprime como IMÁGENES de letras en vez de texto. Port de
// parsers/glifos.py (léelo para la historia): en los estados de cuenta de TDC
// Banamex, el "SU ABONO...GRACIAS" de un pago y bloques como un PAGO
// INTERBANCARIO no traen texto; cada carácter es una imagen-máscara de 1 bit.
// El banco usa siempre el mismo bitmap para el mismo carácter, así que basta
// un diccionario huella-del-bitmap → carácter, sin OCR. La huella es la misma
// que calcula la app de escritorio (sha1 de "AnchoxAlto" + los bytes de la
// máscara, primeros 16 hex), así que las dos comparten la tabla.
//
// Conservador: si una fila trae un bitmap que no está en GLIFOS, NO se
// completa y el lector sigue avisando, en vez de adivinar.

import type { LineaPosicionada, PalabraPosicionada } from "./lineas";

/** Una letra-imagen de la página, en coordenadas de pdfplumber (desde arriba). */
export interface LetraImagen {
  x0: number;
  top: number;
  bottom: number;
  /** Huellas posibles del bitmap: la de sus bytes y la de sus bytes
   * invertidos (pdf.js invierte las máscaras con /Decode [1 0]; pdfminer no). */
  huellas: readonly string[];
}

export interface DetallePagina {
  alto: number;
  lineas: readonly LineaPosicionada[];
  letras: readonly LetraImagen[];
}

/** huella → [carácter, avance sin espacio en pt]. "I" y "l" son el MISMO bitmap. */
export type TablaGlifos = Readonly<Record<string, readonly [string, number]>>;

export const GLIFOS: TablaGlifos = {
  "0dbc3782669656f8": ["#", 4.6],
  "38f71c179b9b777b": ["$", 4.5],
  "4312839ea3bff36b": ["'", 2.0],
  "bd90999555ce4a23": ["(", 2.7],
  "1c208de8de4f3990": [")", 2.8],
  "c09ca868779c33e4": ["*", 3.2],
  "86e179cb8b550c5e": ["+", 6.6],
  "533de241f6ce0578": [",", 2.1],
  "4b21b0c2c06b024a": ["-", 2.4],
  "21e25b0a1ae814b7": [".", 2.1],
  "ba72b824e08578f5": ["0", 4.2],
  "27185c55a551e107": ["1", 3.9],
  "b9693244e97fa64d": ["2", 4.2],
  "cbbf454f28062a8d": ["3", 4.2],
  "0aa9441160fcb702": ["4", 4.8],
  "0d9246028eb36bf8": ["5", 4.5],
  "29e656163ede2eaa": ["6", 4.2],
  "e9cc3d84bce8e722": ["7", 4.2],
  "aa8caf87dc63ae67": ["8", 4.2],
  "665267f50329bdbc": ["9", 4.2],
  "18d6d6de9f8c7cdb": [":", 2.1],
  "3eebfa85fa274a16": ["A", 6.0],
  "cf717a596b35dee4": ["B", 5.4],
  "ee7d30dd11159a12": ["C", 5.7],
  "d53caa52a54fdcca": ["D", 5.7],
  "46d7607c0a74dc11": ["E", 4.8],
  "01382396a94cb450": ["F", 4.8],
  "942c2582d7187d6e": ["G", 6.3],
  "09f42d03cc59540e": ["H", 5.4],
  "0736a5928b2b39b3": ["I", 2.1],
  "14cfb4d54cc5fad6": ["J", 4.8],
  "59e66b74b3a6772c": ["K", 5.7],
  "c6ba9f036a1f3b5d": ["L", 4.8],
  "84538ca58e39b7a7": ["M", 6.9],
  "6df959372034ef92": ["N", 5.4],
  "b013adf95036fdfe": ["O", 6.3],
  "107dc6bd20b44e86": ["P", 5.1],
  "dd4a81283be22b0b": ["Q", 6.3],
  "21b1721a4c49348a": ["R", 5.7],
  "a781caac9f5ce285": ["S", 5.4],
  "adfc3a3ce6450559": ["T", 4.8],
  "63c52c3c3394ad37": ["U", 5.7],
  "3e847824f4960044": ["V", 6.0],
  "8493673e52d454c1": ["W", 8.1],
  "687af7f653233469": ["X", 5.7],
  "f40e3dfd2e3545b7": ["Y", 5.7],
  "f0e64191e3ebbf26": ["Z", 4.8],
  "0c796b309cb82f10": ["a", 4.8],
  "5a44c48d8f4afd65": ["b", 4.5],
  "94bf956e16b21252": ["c", 4.5],
  "affcf3626eb1de2f": ["d", 4.8],
  "7d39b76824980e1e": ["e", 4.5],
  "cc884a9dd8d91787": ["g", 4.8],
  "d59adba68a21d042": ["h", 4.5],
  "9b23ae229343d981": ["i", 2.1],
  "bea9f38406068147": ["j", 3.0],
  "8fa24a5472d80097": ["m", 6.9],
  "3ab26e35f318d90e": ["n", 4.2],
  "c6e3505e45042954": ["o", 4.8],
  "fd852b42cecf40b0": ["p", 4.5],
  "9958dea0c521b64b": ["r", 3.0],
  "0912dd2ca225831d": ["s", 4.5],
  "53a39ac7ee63f54d": ["t", 2.7],
  "ed6a02eacee97ec6": ["u", 4.8],
  "2e354f6a41ef4dd7": ["v", 4.8],
  "9e33b9968d034663": ["y", 5.1],
  "9900c5d0371b2da0": ["Ó", 6.3],
  "cb4329d8a11e4bb2": ["ó", 5.1],
  "c0d0175a9f876be8": ["é", 4.5],
};

const CLAVE_I_O_L = "0736a5928b2b39b3";

/** Un espacio agrega ~2.1–2.4 pt al avance; sin espacio varía ≤ ~0.6 pt. */
const UMBRAL_ESPACIO = 1.1;
/** Separación máxima para que un renglón solo-imagen siga en el bloque. */
const SEPARACION_MAXIMA_RENGLONES = 20.0;
/** Hasta tantas imágenes con su propia base son puntuación desplazada. */
export const MAXIMO_GLIFOS_SUELTOS = 3;
export const DISTANCIA_MAXIMA_SUELTOS = 6.0;

/** sha1("AnchoxAlto" + bytes), primeros 16 hex: la `_huella()` de Python. */
export async function huellasDeMascara(ancho: number, alto: number, datos: Uint8Array): Promise<string[]> {
  const prefijo = new TextEncoder().encode(`${ancho}x${alto}`);
  const huella = async (bytes: Uint8Array) => {
    const todo = new Uint8Array(prefijo.length + bytes.length);
    todo.set(prefijo);
    todo.set(bytes, prefijo.length);
    const digest = await crypto.subtle.digest("SHA-1", todo);
    return [...new Uint8Array(digest)]
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };
  const invertidos = datos.map((b) => b ^ 0xff);
  return [await huella(datos), await huella(invertidos)];
}

// Una pieza de un renglón: una letra-imagen o una palabra de texto.
interface Pieza {
  x0: number;
  texto: string;
  /** Solo en las letras-imagen. */
  avance: number | null;
}

const centro = (caja: { top: number; bottom: number }) => (caja.top + caja.bottom) / 2;

function piezasDeImagenes(letras: readonly LetraImagen[], tabla: TablaGlifos): Pieza[] | null {
  const piezas: Pieza[] = [];
  for (const letra of letras) {
    const clave = letra.huellas.find((h) => h in tabla);
    if (clave === undefined) return null;
    const [caracter, avance] = tabla[clave];
    piezas.push({ x0: letra.x0, texto: clave === CLAVE_I_O_L ? CLAVE_I_O_L : caracter, avance });
  }
  return piezas;
}

const piezasDeTexto = (palabras: readonly PalabraPosicionada[]): Pieza[] =>
  palabras.map((p) => ({ x0: p.x0, texto: p.texto, avance: null }));

/** Entre dos letras-imagen hay espacio si la segunda empieza más lejos que el
 * avance normal de la primera; junto a una palabra de texto, siempre. */
function unir(piezas: readonly Pieza[]): string {
  let texto = "";
  let anterior: Pieza | null = null;
  for (const pieza of [...piezas].sort((a, b) => a.x0 - b.x0)) {
    if (anterior !== null) {
      const hayEspacio =
        pieza.avance === null || anterior.avance === null ? true : pieza.x0 - anterior.x0 > anterior.avance + UMBRAL_ESPACIO;
      if (hayEspacio) texto += " ";
    }
    let contenido = pieza.texto;
    if (contenido === CLAVE_I_O_L) {
      const ultimo = texto.slice(-1);
      contenido = ultimo && ultimo !== ultimo.toUpperCase() ? "l" : "I";
    }
    texto += contenido;
    anterior = pieza;
  }
  return texto;
}

/** Agrupa por la base (±3 pt); los grupitos de signos desplazados ("$", ",",
 * "-") se unen al renglón más cercano. */
export function agruparEnRenglones(letras: readonly LetraImagen[]): LetraImagen[][] {
  let grupos: LetraImagen[][] = [];
  for (const letra of [...letras].sort((a, b) => a.bottom - b.bottom)) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && Math.abs(letra.bottom - ultimo[0].bottom) <= 3) ultimo.push(letra);
    else grupos.push([letra]);
  }
  const grandes = grupos.filter((g) => g.length > MAXIMO_GLIFOS_SUELTOS);
  if (grandes.length > 0) {
    for (const grupo of grupos) {
      if (grupo.length > MAXIMO_GLIFOS_SUELTOS) continue;
      const destino = grandes.reduce((a, b) =>
        Math.abs(b[0].bottom - grupo[0].bottom) < Math.abs(a[0].bottom - grupo[0].bottom) ? b : a
      );
      if (Math.abs(destino[0].bottom - grupo[0].bottom) <= DISTANCIA_MAXIMA_SUELTOS) destino.push(...grupo);
      else grandes.push(grupo);
    }
    grupos = [...grandes].sort((a, b) => a[0].bottom - b[0].bottom);
  }
  return grupos.map((g) => [...g].sort((a, b) => a.x0 - b.x0));
}

function reconstruirBloque(
  lineas: readonly LineaPosicionada[],
  letras: readonly LetraImagen[],
  tabla: TablaGlifos
): [number, string][] | null {
  const renglones: [number, Pieza[]][] = lineas.map((l) => [centro(l), piezasDeTexto(l.palabras)]);
  const soloImagenes: [number, Pieza[]][] = [];
  for (const grupo of agruparEnRenglones(letras)) {
    const piezas = piezasDeImagenes(grupo, tabla);
    const c = centro(grupo[0]);
    const cercano = renglones.reduce((a, b) => (Math.abs(b[0] - c) < Math.abs(a[0] - c) ? b : a));
    if (Math.abs(cercano[0] - c) <= 5) {
      if (piezas === null) {
        if (cercano === renglones[0]) return null;
        continue;
      }
      cercano[1].push(...piezas);
    } else if (piezas !== null && c > renglones[0][0]) soloImagenes.push([c, piezas]);
  }

  if (renglones[0][1].length === lineas[0].palabras.length) return null; // las fechas no ganaron nada

  const todos = [...renglones].sort((a, b) => a[0] - b[0]);
  for (const [c, piezas] of soloImagenes.sort((a, b) => a[0] - b[0])) {
    const ultimo = todos[todos.length - 1][0];
    if (c - ultimo > SEPARACION_MAXIMA_RENGLONES && c > ultimo) break;
    todos.push([c, piezas]);
    todos.sort((a, b) => a[0] - b[0]);
  }
  return todos.filter(([, piezas]) => piezas.length > 0).map(([c, piezas]) => [c, unir(piezas)]);
}

/** Las líneas de la página, con cada línea `esIncompleta` —y el bloque que
 * abre— reconstruida juntando sus palabras y las letras-imagen de sus
 * renglones. Fuera de esos bloques, un renglón de letras-imagen solo se agrega
 * si ya traducido cumple `esEncabezado` (p. ej. "Tarjeta titular: …"). */
export function completarLineasConImagenes(
  pagina: DetallePagina,
  esIncompleta: (linea: string) => boolean,
  esEncabezado: ((linea: string) => boolean) | null = null,
  tabla: TablaGlifos = GLIFOS
): string[] {
  const posiciones = pagina.lineas;
  const lineas = posiciones.map((p) => p.texto);
  if (pagina.letras.length === 0) return lineas;
  if (!lineas.some((l) => esIncompleta(l.trim())) && esEncabezado === null) return lineas;

  // [centro vertical, texto, índice en `posiciones` o null si salió de un bloque]
  const resultado: [number, string, number | null][] = [];
  const zonas: [number, number][] = [];
  let n = 0;
  while (n < posiciones.length) {
    const inicio = posiciones[n];
    if (!esIncompleta(inicio.texto.trim())) {
      resultado.push([centro(inicio), inicio.texto, n]);
      n += 1;
      continue;
    }
    let fin = n + 1;
    while (fin < posiciones.length && posiciones[fin].x0 > inicio.x0 + 5) fin += 1;
    const limite = fin < posiciones.length ? posiciones[fin].top : pagina.alto;
    const zona = pagina.letras.filter((l) => l.bottom > inicio.top && l.top < limite);
    const reconstruido = reconstruirBloque(posiciones.slice(n, fin), zona, tabla);
    if (reconstruido === null) resultado.push(...posiciones.slice(n, fin).map((p): [number, string, null] => [centro(p), p.texto, null]));
    else {
      resultado.push(...reconstruido.map(([c, linea]): [number, string, null] => [c, linea, null]));
      zonas.push([inicio.top, limite]);
    }
    n = fin;
  }

  if (esEncabezado !== null) {
    for (const grupo of agruparEnRenglones(pagina.letras)) {
      const c = centro(grupo[0]);
      if (zonas.some(([arriba, abajo]) => arriba <= c && c < abajo)) continue;
      const piezas = piezasDeImagenes(grupo, tabla);
      if (piezas === null) continue;
      const companera = resultado.findIndex(([cc, , indice]) => indice !== null && Math.abs(cc - c) <= 5);
      if (companera !== -1) {
        const indice = resultado[companera][2] as number;
        const unido = unir([...piezasDeTexto(posiciones[indice].palabras), ...piezas]);
        if (esEncabezado(unido.trim())) resultado[companera] = [resultado[companera][0], unido, null];
        continue;
      }
      const traducido = unir(piezas);
      if (esEncabezado(traducido.trim())) {
        const lugar = resultado.findIndex(([cc]) => cc > c);
        resultado.splice(lugar === -1 ? resultado.length : lugar, 0, [c, traducido, null]);
      }
    }
  }
  return resultado.map(([, linea]) => linea);
}
