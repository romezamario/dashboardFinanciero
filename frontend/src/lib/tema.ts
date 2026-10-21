// Modo claro / oscuro. El script inline de index.html aplica el tema ANTES de
// pintar (misma regla que `temaDeInicio`, repetida allá porque corre antes que
// este código); aquí solo se lee lo que quedó y se cambia con el botón.
// Ordena tu Lana abre en oscuro si el cliente nunca eligió (2026-10-21, pedido
// de Mario); la edición personal sigue el tema del sistema, como siempre.

export type Tema = "light" | "dark";
export const CLAVE_TEMA = "tema";
// Color de la barra del navegador en el teléfono (= --page-plane de cada tema).
export const COLOR_BARRA: Record<Tema, string> = { light: "#f9f9f7", dark: "#0d0d0d" };

/** El tema forzado al cargar, o null para dejar que el CSS siga al sistema. */
export function temaDeInicio(guardado: string | null, edicion: string | null): Tema | null {
  if (guardado === "light" || guardado === "dark") return guardado;
  return edicion === "producto" ? "dark" : null;
}

/** Lo que se ve HOY: el tema forzado en <html> o, si no hay, el del sistema. */
export function temaActual(): Tema {
  const forzado = document.documentElement.getAttribute("data-theme");
  if (forzado === "light" || forzado === "dark") return forzado;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function cambiarTema(tema: Tema) {
  document.documentElement.setAttribute("data-theme", tema);
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", COLOR_BARRA[tema]));
  try {
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Navegación privada / almacenamiento bloqueado: el tema cambia igual,
    // solo no se recuerda para la próxima visita.
  }
}
