// Espacio Salud (Mario, 2026-11-08): datos del anillo Oura que sube el
// colector de la laptop. Viven en el esquema `salud` de Supabase, aparte de
// Finanzas (`public`); ver supabase/espacios/salud.
import { supabase } from "./supabase";

export interface EstadoSalud {
  /** Días con resumen subido (todas las fuentes). */
  dias: number;
  /** Fecha (AAAA-MM-DD) del resumen más reciente, o null si no hay. */
  ultimoDia: string | null;
  /** Momento ISO de la última subida desde la laptop, o null. */
  ultimaSubida: string | null;
}

export async function obtenerEstadoSalud(): Promise<EstadoSalud> {
  const db = supabase.schema("salud");
  const [resumen, subida] = await Promise.all([
    db.from("resumen_diario").select("fecha", { count: "exact" }).order("fecha", { ascending: false }).limit(1),
    db.from("oura_sincronizaciones").select("subida_en").order("subida_en", { ascending: false }).limit(1),
  ]);
  if (resumen.error) throw resumen.error;
  if (subida.error) throw subida.error;
  return {
    dias: resumen.count ?? 0,
    ultimoDia: (resumen.data?.[0] as { fecha?: string } | undefined)?.fecha ?? null,
    ultimaSubida: (subida.data?.[0] as { subida_en?: string } | undefined)?.subida_en ?? null,
  };
}

/** Mensaje para la persona según el error de Supabase. PGRST106 = el esquema
 * no está expuesto en la API (la migración del espacio aún no corre). */
export function mensajeErrorSalud(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code === "PGRST106" || /schema must be one of/i.test(error?.message ?? "")) {
    return "El espacio Salud todavía no está activado en Supabase: falta aplicar su migración.";
  }
  return "No se pudieron cargar los datos de salud. Intenta de nuevo.";
}
