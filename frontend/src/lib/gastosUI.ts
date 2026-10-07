import { useState } from "react";

// Formato y estilos compartidos por las tablas/calendario de "Gastos recientes"
// (vista por correo y vista por estado de cuenta). Fuera de los componentes
// para que esos archivos solo exporten componentes (fast refresh).

export const formatoMoneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

/** Los centavos en 0 se dejan en blanco, como en el reporte diario. */
export function dinero(centavos: number | undefined): string {
  return centavos ? formatoMoneda.format(centavos / 100) : "";
}

export const ESTILO_CABECERA = { background: "var(--text-primary)", color: "var(--page-plane)" } as const;
export const ESTILO_SUBTOTAL_COMERCIO = { background: "var(--page-plane)", fontStyle: "italic" } as const;
export const ESTILO_SUBTOTAL_CATEGORIA = { background: "var(--gridline)", fontWeight: 600 } as const;
export const ESTILO_TOTAL = { background: "var(--text-primary)", color: "var(--page-plane)", fontWeight: 600 } as const;

/** Estado del botón "Descargar Excel" del encabezado de un día: `generar` hace
 * la descarga; aquí solo viven "Generando…" y el mensaje de error. */
export function useDescargaExcel(generar: () => Promise<void>) {
  const [descargando, setDescargando] = useState(false);
  const [errorExcel, setErrorExcel] = useState<string | null>(null);
  async function descargar() {
    setDescargando(true);
    setErrorExcel(null);
    try {
      await generar();
    } catch (e) {
      setErrorExcel(e instanceof Error ? e.message : "No se pudo generar el Excel.");
    } finally {
      setDescargando(false);
    }
  }
  return { descargando, errorExcel, descargar };
}
