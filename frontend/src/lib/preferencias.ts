import { supabase } from "./supabase";

// Preferencias del usuario guardadas en Supabase (tabla `preferencias`, una fila por
// usuario y clave), para que se queden entre sesiones y dispositivos. RLS limita cada
// fila a su dueño; `user_id` lo pone la base (`auth.uid()`), como en el resto de las tablas.

const CLAVE_META_DIARIA = "meta_gasto_diario";

const comoError = (error: { message?: string }) => new Error(error.message ?? "Error de Supabase");

/** La meta de gasto diario guardada (en pesos), o null si nunca se ha cambiado. */
export async function obtenerMetaDiaria(): Promise<number | null> {
  const { data, error } = await supabase
    .from("preferencias")
    .select("valor")
    .eq("clave", CLAVE_META_DIARIA)
    .maybeSingle();
  if (error) throw comoError(error);
  const valor = data?.valor;
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : null;
}

/** Guarda la meta de gasto diario (en pesos). */
export async function guardarMetaDiaria(pesos: number): Promise<void> {
  const { error } = await supabase
    .from("preferencias")
    .upsert(
      { clave: CLAVE_META_DIARIA, valor: pesos, actualizado_en: new Date().toISOString() },
      { onConflict: "user_id,clave" }
    );
  if (error) throw comoError(error);
}
