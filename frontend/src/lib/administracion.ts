// Pantalla de administración de Ordena tu Lana: las muestras anonimizadas que
// mandan los clientes cuando no leemos su PDF. Quién es administrador lo decide
// la base (función es_administrador(), por correo confirmado); las políticas
// de RLS dejan al administrador ver todas las muestras y cambiar su estado.
// Este repo es público: el texto de las muestras nunca va a issues ni logs.

import { supabase } from "./supabase";

export type EstadoMuestra = "nueva" | "en-revision" | "resuelta" | "descartada";
export type MotivoMuestra = "sin-texto" | "banco-desconocido" | "sin-movimientos" | "faltan-movimientos";

export interface Muestra {
  id: string;
  creado_en: string;
  motivo: MotivoMuestra;
  banco_detectado: string | null;
  comentario: string | null;
  paginas: number;
  estado: EstadoMuestra;
}

export const ESTADOS_MUESTRA: readonly { id: EstadoMuestra; etiqueta: string }[] = [
  { id: "nueva", etiqueta: "Nueva" },
  { id: "en-revision", etiqueta: "En revisión" },
  { id: "resuelta", etiqueta: "Resuelta" },
  { id: "descartada", etiqueta: "Descartada" },
];

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

/** Sin el texto (puede pesar cientos de KB cada una): se pide al abrirla. */
export async function obtenerMuestras(): Promise<Muestra[]> {
  const { data, error } = await supabase
    .from("muestras_estados_cuenta")
    .select("id, creado_en, motivo, banco_detectado, comentario, paginas, estado")
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

export async function borrarMuestra(id: string): Promise<void> {
  const { data, error } = await supabase.from("muestras_estados_cuenta").delete().eq("id", id).select("id");
  if (error) throw comoError(error);
  if (!data?.length) throw new Error("No tienes permiso para borrar esta muestra.");
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
    muestra.comentario ? `Comentario del cliente: ${muestra.comentario}` : null,
    "Cada letra se cambió por X/x y cada dígito por 0; las palabras bancarias comunes se conservan.",
    "",
    texto,
  ];
  return partes.filter((p) => p !== null).join("\n");
}
