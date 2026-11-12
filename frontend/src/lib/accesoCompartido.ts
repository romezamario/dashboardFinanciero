// Acceso compartido (2026-10-17): un invitado entra con su propia cuenta y ve
// los datos del dueño (lo resuelve la RLS, ver
// supabase/migrations/20261017170000_acceso_compartido.sql), pero no las
// pestañas Trading y Wiki. Solo aplica a la edición personal.

import { supabase } from "./supabase";

const PREFIJO_GUARDADO = "soy_invitado:";
const enCurso = new Map<string, Promise<boolean | null>>();

/** La RPC; null si falló (no se guarda ni se recuerda: se reintenta). */
async function consultar(): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("soy_invitado");
  if (error) return null;
  return data === true;
}

function leerGuardado(uid: string): boolean | null {
  try {
    const valor = localStorage.getItem(PREFIJO_GUARDADO + uid);
    return valor === "1" ? true : valor === "0" ? false : null;
  } catch {
    return null;
  }
}

function guardar(uid: string, invitado: boolean): void {
  try {
    localStorage.setItem(PREFIJO_GUARDADO + uid, invitado ? "1" : "0");
  } catch {
    // sin almacenamiento: solo se pierde el arranque rápido
  }
}

/** ¿La sesión es de un invitado? Si la consulta falla se trata como dueño: lo
 * que de verdad protege Trading es functions/api/_middleware.ts, y la Wiki no
 * tiene datos.
 *
 * Rápido (2026-11-12, Mario: la tarjeta de Trading tardaba en aparecer en el
 * inicio): la respuesta se pregunta UNA vez por usuario y pestaña del
 * navegador (Inicio y Dashboard la comparten, y volver al inicio no la repite)
 * y se guarda en localStorage por id de usuario; con una respuesta guardada se
 * contesta al instante y la RPC solo la refresca para la próxima vez. Ocultar es
 * cosmético, así que una respuesta vieja por una visita no abre nada. */
export async function soyInvitado(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return (await consultar()) ?? false;
  let promesa = enCurso.get(uid);
  if (!promesa) {
    promesa = consultar().then((invitado) => {
      if (invitado === null) enCurso.delete(uid);
      else guardar(uid, invitado);
      return invitado;
    });
    enCurso.set(uid, promesa);
  }
  const guardado = leerGuardado(uid);
  if (guardado !== null) return guardado;
  return (await promesa) ?? false;
}

/** Pestañas que un invitado no ve. */
export const PESTANAS_SOLO_DUENO: ReadonlySet<string> = new Set(["tecnico", "wiki"]);
