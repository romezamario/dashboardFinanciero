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

export function agruparEnLineas(fragmentos: readonly FragmentoTexto[]): string[] {
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
    .map((renglon) => {
      const porX = [...renglon].sort((a, b) => a.x - b.x);
      let linea = "";
      let finAnterior: number | null = null;
      for (const f of porX) {
        if (finAnterior !== null && f.x - finAnterior > HUECO_ESPACIO && !linea.endsWith(" ") && !f.texto.startsWith(" "))
          linea += " ";
        linea += f.texto;
        finAnterior = Math.max(finAnterior ?? -Infinity, f.x + f.ancho);
      }
      return linea.replace(/\s+/g, " ").trim();
    })
    .filter((linea) => linea !== "");
}
