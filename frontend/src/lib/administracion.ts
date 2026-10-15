// Pantalla de administración de Ordena tu Lana: las muestras anonimizadas que
// mandan los clientes cuando no leemos su PDF. Quién es administrador lo decide
// la base (función es_administrador(), por correo confirmado); las políticas
// de RLS dejan al administrador ver todas las muestras y cambiar su estado.
// Este repo es público: el texto de las muestras nunca va a issues ni logs.

import { supabase } from "./supabase";

export type EstadoMuestra =
  | "nueva"
  | "en-revision"
  | "lista-para-probar"
  | "con-retro"
  | "confirmada"
  | "resuelta"
  | "descartada";
export type MotivoMuestra = "sin-texto" | "banco-desconocido" | "sin-movimientos" | "faltan-movimientos";
/** Lo que decide quien revisa. Solo "lector-nuevo" y "arreglo" pueden dar
 * recompensa, y cada `clave_cambio` paga una sola vez (lo garantiza la base). */
export type ResultadoMuestra = "lector-nuevo" | "arreglo" | "repetida" | "ya-se-leia" | "no-sirve";

export interface Muestra {
  id: string;
  user_id: string;
  creado_en: string;
  motivo: MotivoMuestra;
  banco_detectado: string | null;
  comentario: string | null;
  paginas: number;
  estado: EstadoMuestra;
  resultado: ResultadoMuestra | null;
  clave_cambio: string | null;
  banco_lector: string | null;
  recompensa: boolean;
  mensaje_cliente: string | null;
  revisada_en: string | null;
  confirmada_en: string | null;
  muestra_origen_id: string | null;
  movimientos_leidos: number | null;
}

export const ESTADOS_MUESTRA: readonly { id: EstadoMuestra; etiqueta: string }[] = [
  { id: "nueva", etiqueta: "Nueva" },
  { id: "en-revision", etiqueta: "En revisión" },
  { id: "lista-para-probar", etiqueta: "Lista para probar (esperando al cliente)" },
  { id: "con-retro", etiqueta: "El cliente mandó retroalimentación" },
  { id: "confirmada", etiqueta: "Confirmada por el cliente" },
  { id: "resuelta", etiqueta: "Resuelta" },
  { id: "descartada", etiqueta: "Descartada" },
];

export const RESULTADOS_MUESTRA: readonly { id: ResultadoMuestra; etiqueta: string; recompensa: boolean }[] = [
  { id: "lector-nuevo", etiqueta: "Lector nuevo", recompensa: true },
  { id: "arreglo", etiqueta: "Arreglo de un lector", recompensa: true },
  { id: "repetida", etiqueta: "Repetida (otra muestra ya cubrió el formato)", recompensa: false },
  { id: "ya-se-leia", etiqueta: "Ya se leía completo", recompensa: false },
  { id: "no-sirve", etiqueta: "No sirve", recompensa: false },
];

/** Repetida también avisa al cliente (ya leemos su banco), pero sin recompensa;
 * "ya se leía" y "no sirve" la descartan. */
export function estadoPorResultado(resultado: ResultadoMuestra): EstadoMuestra {
  return resultado === "ya-se-leia" || resultado === "no-sirve" ? "descartada" : "lista-para-probar";
}

/** La clave del cambio: minúsculas, números y guiones (p. ej. "bbva-debito"). */
export function normalizarClaveCambio(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const claveCambioValida = (clave: string) => /^[a-z0-9][a-z0-9-]{1,59}$/.test(clave);

export interface Resolucion {
  resultado: ResultadoMuestra;
  clave_cambio: string | null;
  banco_lector: string | null;
  recompensa: boolean;
  mensaje_cliente: string | null;
}

/** Los cambios a guardar, o el motivo por el que todavía no se puede. */
export function prepararResolucion(r: Resolucion): { error: string } | { cambios: Partial<Muestra> } {
  const conRecompensa = RESULTADOS_MUESTRA.find((x) => x.id === r.resultado)?.recompensa ?? false;
  const recompensa = conRecompensa && r.recompensa;
  const clave = r.clave_cambio ? normalizarClaveCambio(r.clave_cambio) : "";
  if (conRecompensa && !claveCambioValida(clave))
    return { error: "Escribe la clave del cambio (p. ej. bbva-debito): solo minúsculas, números y guiones." };
  return {
    cambios: {
      resultado: r.resultado,
      estado: estadoPorResultado(r.resultado),
      clave_cambio: clave || null,
      banco_lector: r.banco_lector?.trim() || null,
      recompensa,
      mensaje_cliente: r.mensaje_cliente?.trim() || null,
      revisada_en: new Date().toISOString(),
    },
  };
}

export const MOTIVOS_MUESTRA: Readonly<Record<MotivoMuestra, string>> = {
  "sin-texto": "PDF sin texto (escaneado)",
  "banco-desconocido": "Banco que todavía no leemos",
  "sin-movimientos": "Banco reconocido, sin movimientos",
  "faltan-movimientos": "El cliente dice que faltan movimientos",
};

function comoError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error de Supabase");
}

export async function esAdministrador(): Promise<boolean> {
  const { data, error } = await supabase.rpc("es_administrador");
  if (error) return false;
  return data === true;
}

const COLUMNAS_MUESTRA =
  "id, user_id, creado_en, motivo, banco_detectado, comentario, paginas, estado, resultado, clave_cambio, banco_lector, recompensa, mensaje_cliente, revisada_en, confirmada_en, muestra_origen_id, movimientos_leidos";

/** Sin el texto (puede pesar cientos de KB cada una): se pide al abrirla. */
export async function obtenerMuestras(): Promise<Muestra[]> {
  const { data, error } = await supabase
    .from("muestras_estados_cuenta")
    .select(COLUMNAS_MUESTRA)
    .order("creado_en", { ascending: false })
    .limit(500);
  if (error) throw comoError(error);
  return (data ?? []) as Muestra[];
}

export async function obtenerTextoMuestra(id: string): Promise<string> {
  const { data, error } = await supabase
    .from("muestras_estados_cuenta")
    .select("texto_anonimizado")
    .eq("id", id)
    .single();
  if (error) throw comoError(error);
  return data.texto_anonimizado as string;
}

export async function cambiarEstadoMuestra(id: string, estado: EstadoMuestra): Promise<void> {
  const { data, error } = await supabase.from("muestras_estados_cuenta").update({ estado }).eq("id", id).select("id");
  if (error) throw comoError(error);
  if (!data?.length) throw new Error("No tienes permiso para cambiar esta muestra.");
}

export async function resolverMuestra(id: string, cambios: Partial<Muestra>): Promise<void> {
  const { data, error } = await supabase.from("muestras_estados_cuenta").update(cambios).eq("id", id).select("id");
  if (error) throw comoError(error);
  if (!data?.length) throw new Error("No tienes permiso para cambiar esta muestra.");
}

export interface BonificacionOtorgada {
  muestra_id: string | null;
  clave_cambio: string | null;
  plan_id: string;
  meses: number;
}

/** Qué recompensas ya se dieron (el administrador ve todas). */
export async function obtenerBonificacionesOtorgadas(): Promise<BonificacionOtorgada[]> {
  const { data, error } = await supabase.from("bonificaciones").select("muestra_id, clave_cambio, plan_id, meses");
  if (error) throw comoError(error);
  return (data ?? []) as BonificacionOtorgada[];
}

export async function borrarMuestra(id: string): Promise<void> {
  const { data, error } = await supabase.from("muestras_estados_cuenta").delete().eq("id", id).select("id");
  if (error) throw comoError(error);
  if (!data?.length) throw new Error("No tienes permiso para borrar esta muestra.");
}

/**
 * "Empezar desde cero": borra los movimientos, avisos de correo, estados de
 * cuenta, cuentas, categorías y eventos de quien llama (solo administradores;
 * lo decide la base). Conserva perfil, preferencias y muestras. No se puede
 * deshacer. Devuelve cuántos movimientos se borraron.
 */
export async function reiniciarMisDatos(): Promise<number> {
  const { data, error } = await supabase.rpc("reiniciar_mis_datos");
  if (error) throw comoError(error);
  return typeof data === "number" ? data : 0;
}

/** Pendientes = nuevas y en revisión, lo que falta atender. */
export function filtrarMuestras(muestras: readonly Muestra[], filtro: EstadoMuestra | "pendientes" | "todas"): Muestra[] {
  if (filtro === "todas") return [...muestras];
  if (filtro === "pendientes") return muestras.filter((m) => m.estado === "nueva" || m.estado === "en-revision");
  return muestras.filter((m) => m.estado === filtro);
}

/** Lo que se copia para pedirle a Claude el lector: contexto + texto. */
export function textoParaClaude(muestra: Muestra, texto: string): string {
  const partes = [
    `Muestra anonimizada de un estado de cuenta (${muestra.paginas} página(s)).`,
    `Motivo: ${MOTIVOS_MUESTRA[muestra.motivo]}.`,
    muestra.banco_detectado ? `Lector que lo reconoció: ${muestra.banco_detectado}.` : null,
    muestra.movimientos_leidos !== null ? `La app sí leyó ${muestra.movimientos_leidos} movimientos de este PDF.` : null,
    muestra.muestra_origen_id ? "Es retroalimentación: el cliente ya probó un lector y dice que todavía falta algo." : null,
    muestra.comentario ? `Comentario del cliente: ${muestra.comentario}` : null,
    "Cada letra se cambió por X/x y cada dígito por 0; las palabras bancarias comunes se conservan.",
    "",
    texto,
  ];
  return partes.filter((p) => p !== null).join("\n");
}
