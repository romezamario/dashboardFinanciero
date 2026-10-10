import type { CSSProperties } from "react";

/** Fondo y borde de una tarjeta (lo mismo que la clase `.tarjeta` de
 * index.css), para cuando hace falta combinarlo con otros estilos en línea. */
export const estiloTarjeta: CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
};

/** Caja del tooltip de Recharts, igual en todas las gráficas. */
export const estiloTooltip: CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
};
