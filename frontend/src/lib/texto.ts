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

/** Gráficas por comercio sin datos: el comercio solo lo asignan las reglas
 * que lo definen, así que el remedio está en la app de escritorio. */
export const MENSAJE_SIN_COMERCIO =
  'Ninguna transacción tiene un comercio asignado todavía — agrégalo desde "Reglas de categorización..." en la app de escritorio.';
