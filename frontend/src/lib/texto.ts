/**
 * Corta `texto` a `maxLargo` caracteres y agrega "…" si se pasó -- para
 * etiquetas de gráficas en pantallas angostas, donde el ancho disponible
 * para nombres de categoría/comercio/cuenta es mucho menor que en
 * escritorio y Recharts no envuelve el texto de los ejes/nodos por su
 * cuenta.
 */
export function truncar(texto: string, maxLargo: number): string {
  return texto.length > maxLargo ? `${texto.slice(0, maxLargo - 1)}…` : texto;
}
