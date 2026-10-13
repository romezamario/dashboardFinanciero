import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { IdPlan, Periodo } from "./planes";
import { fechaCorta } from "./formato";

// Plan y suscripción del cliente (fase 3 de Ordena tu Lana). El navegador solo
// LEE: el plan efectivo lo calcula la base (mi_plan()) y las suscripciones
// solo las escriben las Edge Functions (supabase/functions/), que hablan con
// Mercado Pago.

/** Mientras Mercado Pago use credenciales de prueba: nada se cobra de verdad.
 * Pasar a false (y cambiar los secretos PRODUCTO_MP_*) es el lanzamiento. */
export const PAGOS_EN_PRUEBA = true;

export type OrigenPlan = "suscripcion" | "prueba" | "gratis";
export type EstadoSuscripcion = "pendiente" | "activa" | "pausada" | "cancelada";

export interface MiPlan {
  plan_id: IdPlan;
  origen: OrigenPlan;
  /** Hasta cuándo vale (fin de la prueba, o de lo pagado tras cancelar); null = sigue. */
  vigente_hasta: string | null;
  periodo: Periodo | null;
}

export interface Suscripcion {
  id: string;
  plan_id: IdPlan;
  periodo: Periodo;
  monto: number;
  estado: EstadoSuscripcion;
  proveedor: string;
  proveedor_id: string;
  periodo_fin: string | null;
  ultimo_cobro_en: string | null;
  ultimo_cobro_estado: string | null;
  creado_en: string;
}

const NOMBRES: Record<IdPlan, string> = { gratis: "Gratis", basico: "Básico", pro: "Pro" };
export const nombreDePlan = (id: IdPlan) => NOMBRES[id];

/** Cuántos días quedan hasta `fechaIso` (hoy cuenta como 0; nunca negativo). */
export function diasHasta(fechaIso: string, ahora: Date): number {
  return Math.max(0, Math.ceil((new Date(fechaIso).getTime() - ahora.getTime()) / 86_400_000));
}

/** Una línea que dice qué plan tiene y hasta cuándo. */
export function describirPlan(plan: MiPlan, ahora: Date): string {
  const nombre = nombreDePlan(plan.plan_id);
  if (plan.origen === "prueba" && plan.vigente_hasta) {
    const dias = diasHasta(plan.vigente_hasta, ahora);
    return `Prueba gratis de ${nombre}: ${dias === 1 ? "te queda 1 día" : `te quedan ${dias} días`}.`;
  }
  if (plan.origen === "suscripcion") {
    const periodo = plan.periodo === "anual" ? "anual" : "mensual";
    return plan.vigente_hasta
      ? `Plan ${nombre} ${periodo}, cancelado: lo tienes hasta el ${fechaCorta(plan.vigente_hasta.slice(0, 10))}.`
      : `Plan ${nombre} ${periodo}.`;
  }
  return "Plan Gratis.";
}

/** La suscripción que hoy cobra (activa o pausada), si hay. */
export function suscripcionViva(suscripciones: Suscripcion[]): Suscripcion | null {
  return suscripciones.find((s) => s.estado === "activa" || s.estado === "pausada") ?? null;
}

/** ¿Ya quedó activa la suscripción con la que regresó de Mercado Pago? */
export function pagoConfirmado(suscripciones: Suscripcion[], preapprovalId: string | null): boolean {
  return suscripciones.some(
    (s) => s.estado === "activa" && (preapprovalId === null || s.proveedor_id === preapprovalId)
  );
}

const comoError = (error: { message?: string }) => new Error(error.message ?? "Error de Supabase");

export async function obtenerMiPlan(): Promise<MiPlan | null> {
  const { data, error } = await supabase.rpc("mi_plan");
  if (error) throw comoError(error);
  return (data as MiPlan[] | null)?.[0] ?? null;
}

export async function obtenerSuscripciones(): Promise<Suscripcion[]> {
  const { data, error } = await supabase
    .from("suscripciones")
    .select("id, plan_id, periodo, monto, estado, proveedor, proveedor_id, periodo_fin, ultimo_cobro_en, ultimo_cobro_estado, creado_en")
    .order("creado_en", { ascending: false });
  if (error) throw comoError(error);
  return (data ?? []) as Suscripcion[];
}

/** El mensaje de error que manda la Edge Function ({error: "..."}), en vez de
 * "Edge Function returned a non-2xx status code". */
async function errorDeFuncion(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const cuerpo = await error.context.json().catch(() => null);
    if (cuerpo && typeof cuerpo.error === "string") return new Error(cuerpo.error);
  }
  return new Error("No se pudo conectar con el servicio de pagos. Intenta de nuevo.");
}

/** Crea la suscripción y devuelve la página de Mercado Pago donde se paga. */
export async function iniciarSuscripcion(plan: Exclude<IdPlan, "gratis">, periodo: Periodo): Promise<string> {
  const { data, error } = await supabase.functions.invoke("crear-suscripcion", {
    body: { plan, periodo, origen: window.location.origin },
  });
  if (error) throw await errorDeFuncion(error);
  return (data as { url: string }).url;
}

export async function cancelarSuscripcion(): Promise<void> {
  const { error } = await supabase.functions.invoke("cancelar-suscripcion", { body: {} });
  if (error) throw await errorDeFuncion(error);
}
