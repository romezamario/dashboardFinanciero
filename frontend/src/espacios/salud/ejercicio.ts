// Sesiones de ejercicio (Mario, 2026-11-15: "¿puedes detectar cuando hago
// ejercicio?"). El colector (repo oura, oura_local.sesiones_ejercicio) las
// detecta en la laptop: minutos seguidos con MET ≥ 3 (moderado) o ≥ 6
// (vigoroso). Aquí solo se resumen. Es una detección propia, no la de Oura:
// no sabe qué deporte fue, y una caminata rápida de 10 min también cuenta.
import { supabase } from "../../lib/supabase";
import type { DiaSalud, SesionEjercicio } from "./salud";

/** OMS: 150 min/semana de actividad moderada (un minuto vigoroso vale por dos). */
export const META_SEMANAL_MIN = 150;

export interface SesionConFecha extends SesionEjercicio {
  fecha: string;
}

/** Todas las sesiones, de la más reciente a la más antigua. */
export function sesionesRecientes(dias: readonly DiaSalud[]): SesionConFecha[] {
  return dias
    .flatMap((d) => (d.ejercicio ?? []).map((s) => ({ ...s, fecha: d.fecha })))
    .sort((a, b) => b.inicio - a.inicio);
}

export interface MinutosDia {
  fecha: string;
  moderados: number;
  vigorosos: number;
}

/** Minutos por día (todos los días del periodo, 0 si no hubo ejercicio). */
export function minutosPorDia(dias: readonly DiaSalud[]): MinutosDia[] {
  return dias.map((d) => ({
    fecha: d.fecha,
    moderados: (d.ejercicio ?? []).reduce((t, s) => t + s.min_moderados, 0),
    vigorosos: (d.ejercicio ?? []).reduce((t, s) => t + s.min_vigorosos, 0),
  }));
}

/** Mismo criterio que el colector v5 (oura_local.clase_de_sesion), para sesiones
 * subidas antes de que trajeran `clase`: ≥ 10 min vigorosos y ≥ 30 % de los
 * minutos activos. Caminar mucho (MET 3–5) es actividad, no entreno. */
export const MINIMO_VIGOROSOS_ENTRENO = 10;
export const FRACCION_VIGOROSA_ENTRENO = 0.3;

export function esEntreno(s: SesionEjercicio): boolean {
  if (s.clase) return s.clase === "entreno";
  const activos = s.min_moderados + s.min_vigorosos;
  return s.min_vigorosos >= MINIMO_VIGOROSOS_ENTRENO && s.min_vigorosos >= FRACCION_VIGOROSA_ENTRENO * activos;
}

/** Tipos confirmados que NO son entreno. */
const TIPOS_NO_ENTRENO = new Set(["caminata", "no_ejercicio"]);

export interface ResumenEjercicio {
  sesiones: number;
  /** Sesiones que fueron entreno: tipo confirmado que no es caminata, o sin
   * confirmar y `esEntreno`. Las demás son caminatas/actividad. */
  entrenos: number;
  minutos: number;
  kcal: number | null;
  /** Minutos "equivalentes" por semana: moderados + 2 × vigorosos. */
  equivalentesPorSemana: number;
  semanas: number;
}

const DIA_MS = 86400000;

/** Resumen del periodo. Las semanas se cuentan entre el primer y el último
 * día CON DATOS del periodo (≥ 1), para no dividir entre días que no existen. */
export function resumenEjercicio(dias: readonly DiaSalud[], etiquetas: readonly EtiquetaEjercicio[] = []): ResumenEjercicio | null {
  if (!dias.length) return null;
  const sesiones = dias.flatMap((d) => d.ejercicio ?? []);
  const dur = Date.parse(dias.at(-1)!.fecha) - Date.parse(dias[0].fecha);
  const semanas = Math.max(1, (dur / DIA_MS + 1) / 7);
  const equivalentes = sesiones.reduce((t, s) => t + s.min_moderados + 2 * s.min_vigorosos, 0);
  const conKcal = sesiones.filter((s) => typeof s.kcal === "number");
  const confirmadas = etiquetas.filter((e) => e.estado === "confirmada");
  const entrenos = sesiones.filter((s) => {
    const e = confirmadas.length ? etiquetaDeSesion(s, confirmadas) : null;
    return e ? !TIPOS_NO_ENTRENO.has(e.tipo) : esEntreno(s);
  }).length;
  return {
    sesiones: sesiones.length,
    entrenos,
    minutos: sesiones.reduce((t, s) => t + s.duracion_min, 0),
    kcal: conKcal.length ? conKcal.reduce((t, s) => t + (s.kcal as number), 0) : null,
    equivalentesPorSemana: Math.round(equivalentes / semanas),
    semanas,
  };
}

/** "HH:MM" de un instante con la zona en que estabas entonces (minutos vs.
 * UTC). Sin zona, la del navegador. */
export function horaEnZona(unix: number, offset?: number): string {
  if (typeof offset !== "number") {
    const d = new Date(unix * 1000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return new Date(unix * 1000 + offset * 60000).toISOString().slice(11, 16);
}

// ---------------------------------------------------------------------------
// Tipo de actividad (Mario, 2026-11-17: "permite que agregue alguna descripción
// como caminata, correr, nadar… después las actividades se clasifiquen solas y
// yo solo confirme"). Las etiquetas viven en salud.ejercicio_etiquetas; la
// sugerencia se calcula aquí al vuelo y no se guarda hasta que Mario la confirma.

export interface TipoActividad {
  id: string;
  nombre: string;
  icono: string;
}

export const TIPOS_ACTIVIDAD: readonly TipoActividad[] = [
  { id: "correr", nombre: "Correr", icono: "🏃" },
  { id: "caminata", nombre: "Caminata", icono: "🚶" },
  { id: "nadar", nombre: "Nadar", icono: "🏊" },
  { id: "bicicleta", nombre: "Bicicleta", icono: "🚴" },
  { id: "gimnasio", nombre: "Gimnasio", icono: "🏋️" },
  { id: "otro", nombre: "Otro", icono: "✳️" },
  { id: "no_ejercicio", nombre: "No fue ejercicio", icono: "✖️" },
];

export function tipoActividad(id: string): TipoActividad {
  return TIPOS_ACTIVIDAD.find((t) => t.id === id) ?? { id, nombre: id.replace(/_/g, " "), icono: "✳️" };
}

export interface EtiquetaEjercicio {
  id?: number;
  inicio: number;
  fin: number;
  fecha: string;
  tipo: string;
  estado: "sugerida" | "confirmada";
  confianza?: number | null;
}

/** La etiqueta de una sesión: la del mismo inicio o, si el colector la movió
 * unos minutos (cambio de umbrales), la que más se traslapa con ella (≥ 50 %
 * de la más corta). */
export function etiquetaDeSesion(s: SesionEjercicio, etiquetas: readonly EtiquetaEjercicio[]): EtiquetaEjercicio | null {
  let mejor: EtiquetaEjercicio | null = null;
  let mejorTraslape = 0;
  for (const e of etiquetas) {
    if (e.inicio === s.inicio) return e;
    const traslape = Math.min(e.fin, s.fin) - Math.max(e.inicio, s.inicio);
    const corta = Math.min(e.fin - e.inicio, s.fin - s.inicio);
    if (traslape > 0 && traslape >= corta * 0.5 && traslape > mejorTraslape) {
      mejor = e;
      mejorTraslape = traslape;
    }
  }
  return mejor;
}

/** Reglas mientras no haya ejemplos confirmados: correr = entreno (`esEntreno`),
 * MET promedio ≥ 6, o FC ≥ 135 lpm con MET ≥ 4.5; lo demás, caminata. */
export const MET_CORRER = 6;
export const LPM_CORRER = 135;
export const MET_CORRER_CON_FC = 4.5;
/** Ejemplos confirmados (sin "no fue ejercicio") a partir de los cuales la
 * sugerencia sale de las sesiones confirmadas más parecidas. */
export const MINIMO_EJEMPLOS = 3;
const VECINOS = 3;

export interface Sugerencia {
  tipo: string;
  /** "reglas" o "parecida a tus sesiones". */
  motivo: string;
}

export interface Ejemplo {
  sesion: SesionEjercicio;
  tipo: string;
}

function distancia(a: SesionEjercicio, b: SesionEjercicio): number {
  const dMet = (a.met_prom - b.met_prom) / 1.5;
  // Sin FC en alguna de las dos, solo cuenta el MET.
  const dLpm = typeof a.lpm_mediana === "number" && typeof b.lpm_mediana === "number" ? (a.lpm_mediana - b.lpm_mediana) / 15 : 0;
  return Math.hypot(dMet, dLpm);
}

export function sugerirTipo(s: SesionEjercicio, ejemplos: readonly Ejemplo[] = []): Sugerencia {
  if (ejemplos.length >= MINIMO_EJEMPLOS) {
    const cercanos = [...ejemplos].sort((a, b) => distancia(s, a.sesion) - distancia(s, b.sesion)).slice(0, VECINOS);
    const votos = new Map<string, number>();
    for (const e of cercanos) votos.set(e.tipo, (votos.get(e.tipo) ?? 0) + 1);
    // Empate: gana el del vecino más cercano (el primero en llegar a su cuenta máxima).
    const max = Math.max(...votos.values());
    const tipo = cercanos.find((e) => votos.get(e.tipo) === max)!.tipo;
    return { tipo, motivo: "parecida a las que ya confirmaste" };
  }
  const correr =
    esEntreno(s) ||
    s.met_prom >= MET_CORRER || (typeof s.lpm_mediana === "number" && s.lpm_mediana >= LPM_CORRER && s.met_prom >= MET_CORRER_CON_FC);
  return { tipo: correr ? "correr" : "caminata", motivo: correr ? "esfuerzo vigoroso sostenido" : "MET moderado: caminar, no entrenar" };
}

/** Sesiones confirmadas que sirven de ejemplo ("no fue ejercicio" también
 * enseña: una sesión parecida tampoco lo será). */
export function ejemplosConfirmados(dias: readonly DiaSalud[], etiquetas: readonly EtiquetaEjercicio[]): Ejemplo[] {
  const confirmadas = etiquetas.filter((e) => e.estado === "confirmada");
  return dias.flatMap((d) =>
    (d.ejercicio ?? []).flatMap((s) => {
      const e = etiquetaDeSesion(s, confirmadas);
      if (e) return [{ sesion: s, tipo: e.tipo }];
      // Historial de la app de Oura: ya trae el tipo (menos "otro", que no enseña nada).
      const t = tipoDeLaApp(s);
      return t && t !== "otro" ? [{ sesion: s, tipo: t }] : [];
    }),
  );
}

/** El tipo que registró la app de Oura (solo sesiones del historial importado). */
export function tipoDeLaApp(s: SesionEjercicio): string | null {
  return s.origen === "oura_app" && s.tipo ? s.tipo : null;
}

export const MOTIVO_APP_OURA = "registrada en la app de Oura";

export interface SesionEtiquetada extends SesionConFecha {
  tipo: string;
  confirmada: boolean;
  motivo?: string;
  /** Etiqueta guardada que le corresponde (para reemplazarla si el inicio cambió). */
  etiqueta: EtiquetaEjercicio | null;
}

export interface DiaEjercicio {
  fecha: string;
  sesiones: SesionEtiquetada[];
  minutos: number;
  kcal: number | null;
  porConfirmar: number;
  /** Tipos del día (sin "no fue ejercicio"), por minutos, de más a menos. */
  tipos: { tipo: string; minutos: number }[];
}

/** Sesiones agrupadas por día local (el que asignó el colector con la zona de
 * ese momento), del día más reciente al más antiguo; dentro del día, en orden. */
export function diasConEjercicio(
  dias: readonly DiaSalud[],
  etiquetas: readonly EtiquetaEjercicio[],
  ejemplos: readonly Ejemplo[] = [],
): DiaEjercicio[] {
  return dias
    .filter((d) => d.ejercicio?.length)
    .map((d) => {
      const sesiones: SesionEtiquetada[] = [...d.ejercicio!]
        .sort((a, b) => a.inicio - b.inicio)
        .map((s) => {
          const e = etiquetaDeSesion(s, etiquetas);
          if (e?.estado === "confirmada") return { ...s, fecha: d.fecha, tipo: e.tipo, confirmada: true, etiqueta: e };
          const app = tipoDeLaApp(s);
          if (app) return { ...s, fecha: d.fecha, tipo: app, confirmada: true, motivo: MOTIVO_APP_OURA, etiqueta: e };
          const sug = e ? { tipo: e.tipo, motivo: "propuesta por el colector" } : sugerirTipo(s, ejemplos);
          return { ...s, fecha: d.fecha, tipo: sug.tipo, confirmada: false, motivo: sug.motivo, etiqueta: e };
        });
      const minutosPorTipo = new Map<string, number>();
      for (const s of sesiones) {
        if (s.tipo !== "no_ejercicio") minutosPorTipo.set(s.tipo, (minutosPorTipo.get(s.tipo) ?? 0) + s.duracion_min);
      }
      const conKcal = sesiones.filter((s) => s.tipo !== "no_ejercicio" && typeof s.kcal === "number");
      return {
        fecha: d.fecha,
        sesiones,
        minutos: sesiones.filter((s) => s.tipo !== "no_ejercicio").reduce((t, s) => t + s.duracion_min, 0),
        kcal: conKcal.length ? conKcal.reduce((t, s) => t + (s.kcal as number), 0) : null,
        porConfirmar: sesiones.filter((s) => !s.confirmada).length,
        tipos: [...minutosPorTipo].map(([tipo, minutos]) => ({ tipo, minutos })).sort((a, b) => b.minutos - a.minutos),
      };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Los días sin las sesiones que Mario confirmó como "no fue ejercicio", para
 * que no cuenten en el resumen ni en la gráfica. */
export function sinDescartadas(dias: readonly DiaSalud[], etiquetas: readonly EtiquetaEjercicio[]): readonly DiaSalud[] {
  const fuera = etiquetas.filter((e) => e.estado === "confirmada" && e.tipo === "no_ejercicio");
  if (!fuera.length) return dias;
  return dias.map((d) => (d.ejercicio?.length ? { ...d, ejercicio: d.ejercicio.filter((s) => !etiquetaDeSesion(s, fuera)) } : d));
}

// --- Supabase --------------------------------------------------------------

interface FilaEtiqueta {
  id: number;
  inicio: number;
  fin: number;
  fecha: string;
  tipo: string;
  estado: "sugerida" | "confirmada";
  confianza: number | null;
}

export async function obtenerEtiquetasEjercicio(): Promise<EtiquetaEjercicio[]> {
  const { data, error } = await supabase
    .schema("salud")
    .from("ejercicio_etiquetas")
    .select("id, inicio, fin, fecha, tipo, estado, confianza")
    .order("inicio");
  if (error) throw error;
  return (data ?? []) as FilaEtiqueta[];
}

/** Confirma (o corrige) el tipo de varias sesiones. Si una etiqueta vieja
 * tenía otro inicio (el colector movió la sesión), se borra para no dejar dos. */
export async function confirmarTipos(sesiones: readonly SesionEtiquetada[], tipo?: string): Promise<EtiquetaEjercicio[]> {
  if (!sesiones.length) return [];
  const filas = sesiones.map((s) => ({
    inicio: s.inicio,
    fin: s.fin,
    fecha: s.fecha,
    tipo: tipo ?? s.tipo,
    estado: "confirmada" as const,
    origen: "dashboard",
    confianza: null,
    actualizado_en: new Date().toISOString(),
  }));
  const { data, error } = await supabase
    .schema("salud")
    .from("ejercicio_etiquetas")
    .upsert(filas, { onConflict: "user_id,inicio" })
    .select("id, inicio, fin, fecha, tipo, estado, confianza");
  if (error) throw error;
  const viejas = sesiones.filter((s) => s.etiqueta?.id && s.etiqueta.inicio !== s.inicio).map((s) => s.etiqueta!.id!);
  if (viejas.length) {
    const { error: e2 } = await supabase.schema("salud").from("ejercicio_etiquetas").delete().in("id", viejas);
    if (e2) throw e2;
  }
  return (data ?? []) as FilaEtiqueta[];
}

/** Las etiquetas locales tras guardar: quita las reemplazadas y pone las nuevas. */
export function aplicarGuardadas(
  actuales: readonly EtiquetaEjercicio[],
  guardadas: readonly EtiquetaEjercicio[],
  reemplazadas: readonly SesionEtiquetada[],
): EtiquetaEjercicio[] {
  const fuera = new Set<number>([...guardadas.map((g) => g.inicio), ...reemplazadas.flatMap((s) => (s.etiqueta ? [s.etiqueta.inicio] : []))]);
  return [...actuales.filter((e) => !fuera.has(e.inicio)), ...guardadas];
}
