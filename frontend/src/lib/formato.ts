/** Formateadores compartidos (es-MX). Crear un `Intl.NumberFormat` es caro,
 * así que viven aquí una sola vez en vez de repetirse en cada componente. */

/** "$1,235" -- pesos sin centavos (gráficas, KPIs, tablas de resumen). */
export const moneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

/** "$1,234.50" -- pesos con centavos (movimientos individuales, tooltips). */
export const monedaConCentavos = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

/** "1.2 mil" -- ejes de gráficas y etiquetas angostas. */
export const compacto = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "37 %" */
export const porcentaje = new Intl.NumberFormat("es-MX", {
  style: "percent",
  maximumFractionDigits: 0,
});

/** "2.5" -- un decimal como máximo. */
export const decimal = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

const formatoFechaCorta = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** "2026-08-14" → "14 ago 2026". Se arma como fecha LOCAL (sin "Z"): como
 * UTC, en México correría al día anterior. */
export function fechaCorta(fechaIso: string): string {
  return formatoFechaCorta.format(new Date(`${fechaIso}T00:00:00`));
}
