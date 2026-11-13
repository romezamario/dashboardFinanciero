// Formatos y constantes compartidos por las gráficas de Salud (separados de los
// componentes para que Fast Refresh funcione).

export const EJE = { fill: "var(--text-muted)", fontSize: 12 };
export const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
export const horaDe = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
export const horasMin = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`;

/** Amarillo de estado "warning" de la paleta de referencia (dataviz); siempre
 * con texto oscuro encima. No hay token compartido de warning en index.css y
 * un subproyecto no lo edita. */
export const AMARILLO_AVISO = "#fab219";
