// Reconstruye las líneas de una página a partir de los fragmentos de texto que
// da pdf.js (cada uno con su posición). Los lectores se escribieron contra el
// texto de pdfplumber (`extract_text()`), que agrupa por renglón visual y
// separa con un espacio lo que está a más de ~3 pt; aquí se hace lo mismo.

export interface FragmentoTexto {
  texto: string;
  /** Esquina inferior izquierda, en puntos (origen abajo, como en el PDF). */
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/** Dos fragmentos están en el mismo renglón si sus bases difieren menos que esto. */
const TOLERANCIA_RENGLON = 3;
/** Un hueco horizontal mayor que esto entre fragmentos se vuelve un espacio. */
const HUECO_ESPACIO = 1.5;

/** Una palabra con su posición horizontal (para juntarla con letras-imagen). */
export interface PalabraPosicionada {
  x0: number;
  x1: number;
  texto: string;
}

/** Una línea con su caja, en coordenadas de pdfplumber: `top`/`bottom` medidos
 * desde el borde SUPERIOR de la página. */
export interface LineaPosicionada {
  texto: string;
  x0: number;
  top: number;
  bottom: number;
  palabras: PalabraPosicionada[];
}

export function agruparEnLineas(fragmentos: readonly FragmentoTexto[]): string[] {
  return agruparEnLineasConPosicion(fragmentos, 0).map((l) => l.texto);
}

/** Palabras de un renglón, como `_piezas_de_texto` de parsers/glifos.py: una
 * palabra termina donde hay más de 1 pt entre un carácter y el siguiente. pdf.js
 * no da la posición de cada carácter, así que se reparte el ancho del fragmento
 * en partes iguales. */
function palabrasDe(porX: readonly FragmentoTexto[]): PalabraPosicionada[] {
  const palabras: PalabraPosicionada[] = [];
  let actual: PalabraPosicionada | null = null;
  for (const f of porX) {
    const ancho = f.texto.length > 0 ? f.ancho / f.texto.length : 0;
    [...f.texto].forEach((caracter, i) => {
      const x0 = f.x + i * ancho;
      if (actual && x0 - actual.x1 > 1.0) {
        palabras.push(actual);
        actual = null;
      }
      if (!caracter.trim()) return;
      if (actual) {
        actual.texto += caracter;
        actual.x1 = x0 + ancho;
      } else actual = { x0, x1: x0 + ancho, texto: caracter };
    });
  }
  if (actual) palabras.push(actual);
  return palabras;
}

/** `altoPagina` convierte la y de pdf.js (desde abajo) en top/bottom (desde
 * arriba). La caja de un carácter va de su descendente (~0.21 del tamaño bajo
 * la base) a su ascendente (~0.79 sobre ella), como la mide pdfminer. */
export function agruparEnLineasConPosicion(fragmentos: readonly FragmentoTexto[], altoPagina: number): LineaPosicionada[] {
  const conTexto = fragmentos.filter((f) => f.texto.trim() !== "");
  // De arriba hacia abajo (y mayor primero) y de izquierda a derecha.
  const ordenados = [...conTexto].sort((a, b) => b.y - a.y || a.x - b.x);

  const renglones: FragmentoTexto[][] = [];
  for (const fragmento of ordenados) {
    const actual = renglones[renglones.length - 1];
    if (actual && Math.abs(actual[0].y - fragmento.y) <= TOLERANCIA_RENGLON) actual.push(fragmento);
    else renglones.push([fragmento]);
  }

  return renglones
    .map((renglon): LineaPosicionada => {
      const porX = [...renglon].sort((a, b) => a.x - b.x);
      let linea = "";
      let finAnterior: number | null = null;
      for (const f of porX) {
        if (finAnterior !== null && f.x - finAnterior > HUECO_ESPACIO && !linea.endsWith(" ") && !f.texto.startsWith(" "))
          linea += " ";
        linea += f.texto;
        finAnterior = Math.max(finAnterior ?? -Infinity, f.x + f.ancho);
      }
      return {
        texto: linea.replace(/\s+/g, " ").trim(),
        x0: porX[0].x,
        top: Math.min(...porX.map((f) => altoPagina - (f.y + 0.79 * f.alto))),
        bottom: Math.max(...porX.map((f) => altoPagina - (f.y - 0.21 * f.alto))),
        palabras: palabrasDe(porX),
      };
    })
    .filter((linea) => linea.texto !== "");
}
