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

const formatoFechaHora = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
/** "2026-10-11T22:53:42Z" → "11 oct, 16:53" en la hora local del navegador. */
export function fechaHora(instanteIso: string): string {
  return formatoFechaHora.format(new Date(instanteIso));
}

const formatoHora = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });
/** Milisegundos → "16:53" en la hora local del navegador (eje de la gráfica de 1 día). */
export function hora(ms: number): string {
  return formatoHora.format(new Date(ms));
}

const formatoDiaMes = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
/** Milisegundos → "11 oct" en la hora local del navegador. */
export function diaMes(ms: number): string {
  return formatoDiaMes.format(new Date(ms));
}

const formatoDiaMesAnio = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });
/** Milisegundos → "11 oct 2026" en la hora local del navegador. */
export function diaMesAnio(ms: number): string {
  return formatoDiaMesAnio.format(new Date(ms));
}

/** "+US$1,234.56" -- ganancias y pérdidas en dólares, con signo. */
export const dolaresConSigno = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  signDisplay: "exceptZero",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

/** "US$0.3625" -- precio de una cripto: 2 decimales desde US$1, hasta 4 por debajo (DOGE, TRX). */
const dolaresChicos = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
export function precioUsd(valor: number): string {
  return (Math.abs(valor) >= 1 ? dolares : dolaresChicos).format(valor);
}

/** "+$1,234.56" / "-$12.30" -- ganancias y pérdidas en pesos, con signo. */
export const monedaConSigno = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  currencyDisplay: "narrowSymbol",
  signDisplay: "exceptZero",
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
/** "0.048731" -- cantidades fraccionarias de un activo (acciones o cripto). */
export const cantidad = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 6 });
export const decimal2 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

/** "4.3" / "4.30" -- siempre con 1 o 2 decimales (tasas, precios). */
export const decimalFijo1 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const decimalFijo2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,235" -- sin decimales. */
export const entero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

/** "0.008 %" -- porcentajes muy chicos (avance del agente hacia su meta), con 2 cifras significativas. */
export const porcentajePequeno = new Intl.NumberFormat("es-MX", {
  style: "percent",
  maximumSignificantDigits: 2,
});
