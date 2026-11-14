// Si la página quedó abierta durante un deploy, los archivos (chunks) de la
// versión anterior ya no existen: Cloudflare solo sirve la última. Detrás de
// Cloudflare Access ese archivo faltante además se redirige al login de Access
// (otro dominio), y Safari lo reporta como "Cross-origin script load denied by
// Cross-Origin Resource Sharing policy" (Mario, 2026-11-14, al abrir Salud en
// el iPhone tras un deploy). En vez de romper la vista, se recarga la página
// UNA vez para tomar la versión nueva (y renovar la sesión de Access).
export const CLAVE_RECARGA_POR_VERSION = "recargado-por-version-nueva";

export interface EntornoRecarga {
  almacen: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  recargar: () => void;
}

const entornoNavegador = (): EntornoRecarga => ({
  almacen: sessionStorage,
  recargar: () => window.location.reload(),
});

export function cargarConRecarga<T>(importar: () => Promise<T>, entorno: () => EntornoRecarga = entornoNavegador): Promise<T> {
  return importar().then(
    (modulo) => {
      try {
        entorno().almacen.removeItem(CLAVE_RECARGA_POR_VERSION);
      } catch {
        // sin sessionStorage no hay nada que limpiar
      }
      return modulo;
    },
    (error: unknown) => {
      try {
        const { almacen, recargar } = entorno();
        if (!almacen.getItem(CLAVE_RECARGA_POR_VERSION)) {
          almacen.setItem(CLAVE_RECARGA_POR_VERSION, "1");
          recargar();
          return new Promise<T>(() => {});
        }
      } catch {
        // sin sessionStorage no se puede evitar un ciclo de recargas: falla
      }
      throw error;
    },
  );
}
