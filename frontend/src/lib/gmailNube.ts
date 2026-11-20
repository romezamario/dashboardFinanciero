import { supabase } from "./supabase";

/** Una revisión de Gmail hecha en la nube (tabla `gmail_revisiones`, la escribe la
 * Edge Function `revisar-gmail`: cada 15 min o con "Revisar ahora"). */
export interface RevisionGmail {
  empezo_en: string;
  origen: "programada" | "manual";
  resultado: "ok" | "permiso_invalido" | "limite" | "sin_reglas" | "error";
  mensaje: string | null;
  avisos: number;
  nuevos: number;
  recategorizados: number;
  debitos: number;
  ilegibles: string[];
  sin_categoria: string[];
  codigos_sin_confirmar: string[];
}

export interface ConexionGmail {
  correo: string | null;
  actualizado_en: string;
  /** Google rechazó el permiso (venció o se revocó): hay que reconectar. */
  invalida?: boolean;
  /** Dónde se autorizó: la app de escritorio o el botón del dashboard. */
  origen?: "escritorio" | "dashboard";
}

export interface EstadoGmail {
  /** null = el Gmail no está conectado a la nube (se conecta desde aquí o desde la app de escritorio). */
  conexion: ConexionGmail | null;
  ultima: RevisionGmail | null;
  /** La última que terminó bien (para "datos al día hasta…"). */
  ultimaBien: RevisionGmail | null;
}

const COLUMNAS =
  "empezo_en, origen, resultado, mensaje, avisos, nuevos, recategorizados, debitos, ilegibles, sin_categoria, codigos_sin_confirmar";

export async function obtenerEstadoGmail(): Promise<EstadoGmail> {
  const [conexion, ultima, ultimaBien] = await Promise.all([
    supabase.rpc("estado_conexion_gmail"),
    supabase.from("gmail_revisiones").select(COLUMNAS).order("empezo_en", { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from("gmail_revisiones")
      .select(COLUMNAS)
      .in("resultado", ["ok", "sin_reglas"])
      .order("empezo_en", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error = conexion.error ?? ultima.error ?? ultimaBien.error;
  if (error) throw new Error(error.message);
  const filas = (conexion.data ?? []) as ConexionGmail[];
  return {
    conexion: filas[0] ?? null,
    ultima: (ultima.data as RevisionGmail | null) ?? null,
    ultimaBien: (ultimaBien.data as RevisionGmail | null) ?? null,
  };
}

async function invocar<T>(funcion: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(funcion, { body });
  if (error) {
    // El cuerpo del error trae el mensaje en español de la función.
    const contexto = (error as { context?: Response }).context;
    const cuerpo = contexto && typeof contexto.json === "function" ? await contexto.json().catch(() => null) : null;
    throw new Error(cuerpo?.error ?? error.message);
  }
  return data as T;
}

/** Pide una revisión ya (la misma que corre cada 15 min) y devuelve su resultado. */
export function revisarGmailAhora(): Promise<RevisionGmail> {
  return invocar<RevisionGmail>("revisar-gmail", {});
}

/** Empieza la autorización de Gmail desde el dashboard: la Edge Function
 * `gmail-oauth` devuelve la página de Google; al terminar, Google regresa a
 * la función y ella al dashboard con `?gmail=…` (ver `leerResultadoOauth`). */
export async function conectarGmail(): Promise<void> {
  const { url } = await invocar<{ url: string }>("gmail-oauth", { origen: window.location.origin });
  window.location.assign(url);
}

export type ResultadoOauth = "conectado" | "cancelado" | "sin_permiso" | "error";

/** Lee `?gmail=…&gmail_detalle=…` del regreso de `gmail-oauth`. */
export function leerResultadoOauth(search: string): { resultado: ResultadoOauth; detalle: string | null } | null {
  const q = new URLSearchParams(search);
  const resultado = q.get("gmail");
  if (resultado !== "conectado" && resultado !== "cancelado" && resultado !== "sin_permiso" && resultado !== "error") return null;
  return { resultado, detalle: q.get("gmail_detalle") };
}

/** La misma URL sin los parámetros del regreso (para `history.replaceState`). */
export function sinResultadoOauth(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("gmail");
  u.searchParams.delete("gmail_detalle");
  return u.toString();
}

export function textoResultadoOauth(r: { resultado: ResultadoOauth; detalle: string | null }): { texto: string; error: boolean } {
  switch (r.resultado) {
    case "conectado":
      return { texto: "Gmail conectado. Revisando tus avisos…", error: false };
    case "cancelado":
      return { texto: "Cancelaste la autorización de Gmail; no cambió nada.", error: true };
    case "sin_permiso":
      return {
        texto: "Google no dio permiso de leer tu correo (la casilla de Gmail quedó sin marcar). Vuelve a conectar y márcala.",
        error: true,
      };
    default:
      return { texto: `No se pudo conectar Gmail${r.detalle ? `: ${r.detalle}` : "."}`, error: true };
  }
}

/** ¿Hay que (re)conectar? Sin conexión, marcada inválida o la última revisión rechazó el permiso. */
export function necesitaConectar(estado: EstadoGmail): boolean {
  return !estado.conexion || !!estado.conexion.invalida || estado.ultima?.resultado === "permiso_invalido";
}

/** Revisiones programadas cada 15 min: más de una hora sin una buena = algo pasa. */
export const MINUTOS_REVISION_ATRASADA = 60;

/** "hace 3 min", "hace 2 h", "hace 3 días". */
export function haceCuanto(instanteIso: string, ahora: Date = new Date()): string {
  const minutos = Math.max(0, Math.round((ahora.getTime() - new Date(instanteIso).getTime()) / 60_000));
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} día${dias === 1 ? "" : "s"}`;
}

/** Línea de estado y si es un problema (para pintarla en rojo). */
export function textoEstadoGmail(estado: EstadoGmail, ahora: Date = new Date()): { texto: string; problema: boolean } {
  const { conexion, ultima, ultimaBien } = estado;
  if (!conexion) {
    return {
      texto: "Gmail todavía no está conectado al dashboard: usa \"Conectar Gmail\" para autorizar la lectura de tus avisos.",
      problema: true,
    };
  }
  if (conexion.invalida && ultima?.resultado !== "permiso_invalido") {
    return { texto: "El permiso de Gmail venció o fue revocado: usa \"Reconectar Gmail\".", problema: true };
  }
  if (!ultima) return { texto: "Gmail conectado. La primera revisión corre en los próximos 15 minutos.", problema: false };
  if (ultima.resultado !== "ok" && ultima.resultado !== "sin_reglas") {
    return { texto: `La última revisión de Gmail (${haceCuanto(ultima.empezo_en, ahora)}) falló: ${ultima.mensaje ?? "error desconocido"}`, problema: true };
  }
  const minutos = (ahora.getTime() - new Date(ultimaBien!.empezo_en).getTime()) / 60_000;
  const partes = [`Gmail revisado ${haceCuanto(ultimaBien!.empezo_en, ahora)}`];
  if (ultima.nuevos) partes.push(`${ultima.nuevos} aviso${ultima.nuevos === 1 ? "" : "s"} nuevo${ultima.nuevos === 1 ? "" : "s"}`);
  let texto = partes.join(" · ") + ". Se revisa solo cada 15 minutos.";
  if (ultima.resultado === "sin_reglas" && ultima.mensaje) texto += ` ${ultima.mensaje}`;
  return { texto, problema: minutos > MINUTOS_REVISION_ATRASADA || ultima.resultado === "sin_reglas" };
}
