// Una sola base de código, dos despliegues (decisión del 2026-10-11):
// - "personal": el dashboard de siempre, con su propio Supabase y Cloudflare
//   Pages detrás de Cloudflare Access. Es el valor por defecto, así que un
//   build sin VITE_EDICION se ve exactamente igual que antes.
// - "producto": FinanzasPersonales, la instancia para clientes (otro proyecto
//   de Supabase y de Pages). Sin las pestañas que solo tienen sentido para el
//   dueño: QQQ/TQQQ + Macro (datos de Yahoo que no se pueden revender),
//   Shophunters (un evento personal), la Wiki interna y el agente de trading.

export type Edicion = "personal" | "producto";

/** Funciones del tablero que solo existen en la edición personal. */
export type FuncionPersonal = "tecnico" | "shophunters" | "wiki" | "agente";

const SOLO_PERSONAL: ReadonlySet<FuncionPersonal> = new Set(["tecnico", "shophunters", "wiki", "agente"]);

export function edicionDe(valor: string | undefined): Edicion {
  return valor === "producto" ? "producto" : "personal";
}

export function incluyeFuncion(edicion: Edicion, funcion: FuncionPersonal): boolean {
  return edicion === "personal" || !SOLO_PERSONAL.has(funcion);
}

export function nombreApp(edicion: Edicion): string {
  return edicion === "producto" ? "Ordena tu Lana" : "Dashboard Financiero";
}

export const EDICION: Edicion = edicionDe(import.meta.env.VITE_EDICION);
export const NOMBRE_APP = nombreApp(EDICION);
