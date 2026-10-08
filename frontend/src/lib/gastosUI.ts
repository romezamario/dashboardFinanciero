import { useState } from "react";
import { monedaConCentavos as formatoMoneda } from "./formato";

export { formatoMoneda };

// Formato y estilos compartidos por las tablas/calendario de "Gastos recientes"
// (vista por correo y vista por estado de cuenta). Fuera de los componentes
// para que esos archivos solo exporten componentes (fast refresh).

/** Los centavos en 0 se dejan en blanco, como en el reporte diario. */
export function dinero(centavos: number | undefined): string {
  return centavos ? formatoMoneda.format(centavos / 100) : "";
}

/** Mes y día elegidos en el calendario. `mesElegido` null = el más reciente;
 * `seleccion` undefined = aún no elige (se abre el día más reciente), null =
 * cerró el detalle a propósito. */
export interface VistaCalendario {
  mesElegido: string | null;
  seleccion: string | null | undefined;
}

export const VISTA_CALENDARIO_INICIAL: VistaCalendario = { mesElegido: null, seleccion: undefined };

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
