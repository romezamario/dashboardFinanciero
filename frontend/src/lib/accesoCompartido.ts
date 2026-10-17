// Acceso compartido (2026-10-17): un invitado entra con su propia cuenta y ve
// los datos del dueño (lo resuelve la RLS, ver
// supabase/migrations/20261017170000_acceso_compartido.sql), pero no las
// pestañas Trading y Wiki. Solo aplica a la edición personal.

import { supabase } from "./supabase";

/** ¿La sesión es de un invitado? Si la consulta falla se trata como dueño: lo
 * que de verdad protege Trading es functions/api/_middleware.ts, y la Wiki no
 * tiene datos. */
export async function soyInvitado(): Promise<boolean> {
  const { data, error } = await supabase.rpc("soy_invitado");
  if (error) return false;
  return data === true;
}

/** Pestañas que un invitado no ve. */
export const PESTANAS_SOLO_DUENO: ReadonlySet<string> = new Set(["tecnico", "wiki"]);
