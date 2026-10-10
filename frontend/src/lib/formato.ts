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

/** "$1.2 mil" -- pesos en celdas angostas (calendario en teléfono). */
export const monedaCompacta = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "US$612.34" -- cotizaciones (QQQ/TQQQ). */
export const dolares = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "+1.2 %" / "−0.4 %" -- cambios con signo, un decimal. */
export const porcentajeConSigno1 = new Intl.NumberFormat("es-MX", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** "12.5 %" -- un decimal, sin signo. */
export const porcentaje1 = new Intl.NumberFormat("es-MX", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "1.25" -- hasta dos decimales. */
export const decimal2 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

/** "4.3" / "4.30" -- siempre con 1 o 2 decimales (tasas, precios). */
export const decimalFijo1 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const decimalFijo2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,235" -- sin decimales. */
export const entero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
