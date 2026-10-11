import { supabase } from "./supabase";

// Perfil del usuario (tabla `perfiles`, una fila por usuario que crea el
// trigger al registrarse) y borrado de la cuenta (función borrar_mi_cuenta).
// RLS limita la fila a su dueño, como en el resto de las tablas.

export interface Perfil {
  nombre: string | null;
  terminos_version: string | null;
  terminos_aceptados_en: string | null;
}

const comoError = (error: { message?: string }) => new Error(error.message ?? "Error de Supabase");

/** null si el usuario no tiene perfil (no debería pasar: lo crea el registro). */
export async function obtenerPerfil(): Promise<Perfil | null> {
  const { data, error } = await supabase
    .from("perfiles")
    .select("nombre, terminos_version, terminos_aceptados_en")
    .maybeSingle();
  if (error) throw comoError(error);
  return data;
}

/** Upsert: también sirve si por algo la fila no existiera. */
export async function guardarNombre(nombre: string): Promise<void> {
  const { error } = await supabase
    .from("perfiles")
    .upsert({ nombre: nombre.trim() || null, actualizado_en: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw comoError(error);
}

/** Borra al usuario de la sesión y, en cascada, todas sus filas. */
export async function borrarMiCuenta(): Promise<void> {
  const { error } = await supabase.rpc("borrar_mi_cuenta");
  if (error) throw comoError(error);
}
