// Formatos y constantes compartidos por las gráficas de Salud (separados de los
// componentes para que Fast Refresh funcione).

export const EJE = { fill: "var(--text-muted)", fontSize: 12 };
export const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
/** "HH:MM" de un instante unix. Con `utcOffset` (minutos vs. UTC, la zona en
 * que estabas ese día, `DiaSalud.utcOffset`) se muestra en ESA zona: una
 * noche en CDMX sigue diciendo 23:30 aunque abras el dashboard en Las Vegas
 * (auditoría 2026-11-14, A2). Sin él, la zona del navegador. */
export function horaDe(unix: number, utcOffset?: number | null): string {
  if (typeof utcOffset === "number" && Number.isFinite(utcOffset)) {
    const d = new Date((unix + utcOffset * 60) * 1000);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  return new Date(unix * 1000).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Hora del día con fracción (0–24) de un instante unix en la zona del día. */
export function horaDecimal(unix: number, utcOffset?: number | null): number {
  if (typeof utcOffset === "number" && Number.isFinite(utcOffset)) {
    const d = new Date((unix + utcOffset * 60) * 1000);
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  }
  const d = new Date(unix * 1000);
  return d.getHours() + d.getMinutes() / 60;
}
export const horasMin = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`;

/** Amarillo de estado "warning" de la paleta de referencia (dataviz); siempre
 * con texto oscuro encima. No hay token compartido de warning en index.css y
 * un subproyecto no lo edita. */
export const AMARILLO_AVISO = "#fab219";
