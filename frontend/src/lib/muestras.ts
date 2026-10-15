// Recompensa por muestras anonimizadas, del lado del cliente (2026-10-15).
// Quien manda una muestra que termina en un lector nuevo o en un arreglo, y
// confirma que ya ve todos sus movimientos, recibe tiempo de plan. Quién lo
// merece y cuánto lo decide la base (confirmar_muestra() y bonificaciones);
// el navegador solo muestra y pregunta. Nunca se piden movimientos reales.

import { supabase } from "./supabase";
import { fechaCorta } from "./formato";
import type { IdPlan } from "./planes";

/** Una muestra propia que el administrador ya resolvió y espera que el
 * cliente pruebe el lector. */
export interface MuestraPorConfirmar {
  id: string;
  banco_lector: string | null;
  banco_detectado: string | null;
  mensaje_cliente: string | null;
  recompensa: boolean;
}

export interface Bonificacion {
  id: string;
  plan_id: Exclude<IdPlan, "gratis">;
  meses: number;
  /** null = saldo a favor: empieza cuando termine su suscripción. */
  desde: string | null;
  hasta: string | null;
  creado_en: string;
}

/** Tipos de movimiento que suelen faltar; el cliente elige, no copia los suyos. */
export const TIPOS_FALTANTES = [
  "Compras a meses sin intereses",
  "Pagos o abonos a la tarjeta",
  "Movimientos de una tarjeta adicional o digital",
  "Comisiones, intereses o IVA",
  "Movimientos en dólares u otra moneda",
  "Transferencias o depósitos",
] as const;

const MAXIMO_COMENTARIO = 500;

/** Lo que se guarda en `comentario` para "faltan movimientos": los tipos
 * elegidos, cuántos faltan más o menos y el detalle (sin datos reales). */
export function comentarioDeFaltantes(tipos: readonly string[], cuantos: string, detalle: string): string {
  const partes = [
    tipos.length ? `Faltan: ${tipos.join("; ")}.` : null,
    /^\d{1,4}$/.test(cuantos.trim()) ? `Aprox. ${Number(cuantos.trim())} movimiento(s) faltante(s).` : null,
    detalle.trim() ? `Detalle: ${detalle.trim()}` : null,
  ];
  return partes.filter(Boolean).join(" ").slice(0, MAXIMO_COMENTARIO);
}

/** Un detalle que parece traer datos reales: montos, números largos o correos. */
export function pareceDatoReal(texto: string): boolean {
  return /\$\s*\d|\d[\d,]*\.\d{2}\b|\d{6,}|@\w/.test(texto);
}

/** La muestra pendiente que corresponde a un PDF leído con `banco` (sin
 * banco_lector, cualquiera). */
export function muestraParaBanco(
  pendientes: readonly MuestraPorConfirmar[],
  banco: string
): MuestraPorConfirmar | null {
  const b = banco.toLowerCase();
  return pendientes.find((m) => !m.banco_lector || m.banco_lector.toLowerCase() === b) ?? null;
}

const NOMBRES: Record<Bonificacion["plan_id"], string> = { basico: "Básico", pro: "Pro" };
const meses = (n: number) => (n === 1 ? "1 mes" : `${n} meses`);
const dia = (iso: string) => fechaCorta(iso.slice(0, 10));

/** Una línea por bonificación, para Mi cuenta. */
export function describirBonificacion(b: Bonificacion, ahora: Date): string {
  const que = `${meses(b.meses)} de ${NOMBRES[b.plan_id]} gratis`;
  if (!b.desde || !b.hasta) return `${que}, a favor: se aplica cuando termine tu suscripción.`;
  if (new Date(b.hasta) <= ahora) return `${que} (del ${dia(b.desde)} al ${dia(b.hasta)}, ya usado).`;
  if (new Date(b.desde) > ahora) return `${que}: empieza el ${dia(b.desde)} y dura hasta el ${dia(b.hasta)}.`;
  return `${que}: vigente hasta el ${dia(b.hasta)}.`;
}

/** Lo que se le dice al confirmar. */
export function felicitacion(b: Bonificacion | null, ahora: Date): string {
  if (!b) return "¡Gracias por confirmarlo! Tu ayuda hace que Ordena tu Lana lea mejor los estados de cuenta.";
  return `¡Felicidades! Tu muestra ayudó a mejorar Ordena tu Lana. Te regalamos ${describirBonificacion(b, ahora)}`;
}

const comoError = (error: { message?: string }) => new Error(error.message ?? "Error de Supabase");

async function miId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

// El administrador ve las muestras y bonificaciones de todos (RLS), así que
// aquí sí se filtra por el usuario de la sesión: son "las mías".
export async function obtenerMuestrasPorConfirmar(): Promise<MuestraPorConfirmar[]> {
  const id = await miId();
  if (!id) return [];
  const { data, error } = await supabase
    .from("muestras_estados_cuenta")
    .select("id, banco_lector, banco_detectado, mensaje_cliente, recompensa")
    .eq("user_id", id)
    .eq("estado", "lista-para-probar")
    .order("revisada_en", { ascending: true });
  if (error) throw comoError(error);
  return (data ?? []) as MuestraPorConfirmar[];
}

export async function obtenerMisBonificaciones(): Promise<Bonificacion[]> {
  const id = await miId();
  if (!id) return [];
  const { data, error } = await supabase
    .from("bonificaciones")
    .select("id, plan_id, meses, desde, hasta, creado_en")
    .eq("user_id", id)
    .order("creado_en", { ascending: false });
  if (error) throw comoError(error);
  return (data ?? []) as Bonificacion[];
}

/** "Ya veo todos mis movimientos". Devuelve la bonificación, si la hubo. */
export async function confirmarMuestra(id: string): Promise<Bonificacion | null> {
  const { data, error } = await supabase.rpc("confirmar_muestra", { p_muestra: id });
  if (error) throw comoError(error);
  return ((data as Bonificacion[] | null) ?? [])[0] ?? null;
}
