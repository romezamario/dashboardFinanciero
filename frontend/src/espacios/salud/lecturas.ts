// Panel "Colector" (Mario, 2026-11-19): ¿la laptop está leyendo el anillo?
// Desde el colector v6 (repo romezamario/oura, colector/subir_oura.py) cada
// corrida horaria deja una fila en `oura_sincronizaciones`, también las que
// fallan (resultado, código, mensaje, eventos nuevos, hasta dónde hay datos),
// y cada día de `resumen_diario` trae `eventos_horas` (eventos por hora local).
// Aquí: leerlas y las funciones puras del panel (probadas en lecturas.test.ts).
import { supabase } from "../../lib/supabase";
import { num, restarDias, type DiaSalud } from "./salud";

export type Resultado = "ok" | "sin_anillo" | "conexion_cortada" | "error";

export interface Corrida {
  /** ISO de la subida (cuando terminó la corrida). */
  en: string;
  resultado: Resultado;
  codigo: number | null;
  mensaje: string | null;
  eventosNuevos: number | null;
  /** Hasta qué momento (unix s) había datos del anillo en la laptop. */
  ultimoEventoUnix: number | null;
  duracionS: number | null;
  version: number | null;
  commit: string | null;
  alDia: boolean | null;
  errorActualizacion: string | null;
  bateria: number | null;
  /** Zona de la laptop en esa corrida (minutos vs. UTC). */
  offset: number | null;
}

export interface LecturaCorridas {
  corridas: Corrida[];
  /** true = Supabase aún no tiene las columnas de la bitácora (migración sin
   * aplicar): solo se ven las corridas buenas. */
  sinBitacora: boolean;
}

/** Sin lectura buena desde hace estas horas: "atrasado" (amarillo) y, desde
 * HORAS_SIN_LECTURA (el aviso de Windows del colector), "sin lecturas". */
export const HORAS_ATRASADO = 2;
export const HORAS_SIN_LECTURA = 6;
/** Días de la rejilla de corridas y de la de datos por hora. */
export const DIAS_CORRIDAS = 7;
export const DIAS_DATOS = 14;
/** Un hueco de datos se lista si dura al menos estas horas seguidas. */
export const HORAS_HUECO_MINIMO = 2;

const COLUMNAS_BASE = "subida_en, version_colector, colector_commit, colector_al_dia, actualizacion_error, bateria_pct, utc_offset_min";
const COLUMNAS_BITACORA = `${COLUMNAS_BASE}, resultado, codigo, mensaje, eventos_nuevos, ultimo_evento_unix, duracion_s`;

interface FilaCorrida {
  subida_en: string;
  resultado?: string | null;
  codigo?: number | null;
  mensaje?: string | null;
  eventos_nuevos?: number | null;
  ultimo_evento_unix?: number | null;
  duracion_s?: number | null;
  version_colector?: number | null;
  colector_commit?: string | null;
  colector_al_dia?: boolean | null;
  actualizacion_error?: string | null;
  bateria_pct?: number | null;
  utc_offset_min?: number | null;
}

const RESULTADOS: readonly Resultado[] = ["ok", "sin_anillo", "conexion_cortada", "error"];

export function filaACorrida(f: FilaCorrida): Corrida {
  return {
    en: f.subida_en,
    // Antes del colector v6 solo se anotaban las corridas buenas.
    resultado: RESULTADOS.includes(f.resultado as Resultado) ? (f.resultado as Resultado) : "ok",
    codigo: num(f.codigo),
    mensaje: f.mensaje ?? null,
    eventosNuevos: num(f.eventos_nuevos),
    ultimoEventoUnix: num(f.ultimo_evento_unix),
    duracionS: num(f.duracion_s),
    version: num(f.version_colector),
    commit: f.colector_commit ?? null,
    alDia: typeof f.colector_al_dia === "boolean" ? f.colector_al_dia : null,
    errorActualizacion: f.actualizacion_error ?? null,
    bateria: num(f.bateria_pct),
    offset: num(f.utc_offset_min),
  };
}

/** Las corridas de la laptop desde esa fecha, de la más vieja a la más nueva. */
export async function obtenerCorridas(desde: string): Promise<LecturaCorridas> {
  const leer = async (columnas: string) => {
    const filas: FilaCorrida[] = [];
    for (let inicio = 0; inicio < 20000; inicio += 1000) {
      const { data, error } = await supabase
        .schema("salud")
        .from("oura_sincronizaciones")
        .select(columnas)
        .eq("origen", "laptop")
        .gte("subida_en", `${desde}T00:00:00Z`)
        .order("subida_en", { ascending: true })
        .order("id", { ascending: true })
        .range(inicio, inicio + 999);
      if (error) throw error;
      filas.push(...((data ?? []) as unknown as FilaCorrida[]));
      if (!data || data.length < 1000) break;
    }
    return filas.map(filaACorrida);
  };
  try {
    return { corridas: await leer(COLUMNAS_BITACORA), sinBitacora: false };
  } catch (e) {
    // 42703 / PGRST204: falta una columna (la migración aún no corre).
    const texto = `${(e as { code?: string }).code ?? ""} ${(e as { message?: string }).message ?? ""}`;
    if (!/42703|PGRST20|resultado|column/i.test(texto)) throw e;
    return { corridas: await leer(COLUMNAS_BASE), sinBitacora: true };
  }
}

/** Fecha desde la que el panel necesita corridas. */
export const desdeCorridas = (hoy: string) => restarDias(hoy, Math.max(DIAS_CORRIDAS, DIAS_DATOS));

// ------------------------------------------------------------- resumen

export type EstadoGeneral = "bien" | "atrasado" | "sin_lecturas" | "sin_datos";

export interface ResumenLecturas {
  estado: EstadoGeneral;
  /** Frase para la persona: qué pasa y qué hacer. */
  motivo: string;
  ultima: Corrida | null;
  ultimaOk: Corrida | null;
  /** Horas desde la última lectura buena (null = ninguna). */
  horasSinOk: number | null;
  /** Hasta dónde hay datos del anillo (unix s, la corrida más reciente que lo sabe). */
  datosHasta: number | null;
  /** Corridas de las últimas 24 h por resultado. */
  ultimas24: Record<Resultado, number>;
  /** ¿Hay alguna corrida del colector v6 (que anota también las fallas)? */
  conBitacora: boolean;
}

const horasEntre = (iso: string, ahora: Date) => (ahora.getTime() - Date.parse(iso)) / 3600000;

export function textoHoras(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} días`;
}

export function resumirLecturas(corridas: readonly Corrida[], ahora = new Date()): ResumenLecturas {
  const ultimas24: Record<Resultado, number> = { ok: 0, sin_anillo: 0, conexion_cortada: 0, error: 0 };
  let ultimaOk: Corrida | null = null;
  let datosHasta: number | null = null;
  for (const c of corridas) {
    if (horasEntre(c.en, ahora) <= 24) ultimas24[c.resultado] += 1;
    if (c.resultado === "ok") ultimaOk = c;
    if (c.ultimoEventoUnix != null) datosHasta = Math.max(datosHasta ?? 0, c.ultimoEventoUnix);
  }
  const ultima = corridas.at(-1) ?? null;
  const conBitacora = corridas.some((c) => c.codigo != null);
  const horasSinOk = ultimaOk ? horasEntre(ultimaOk.en, ahora) : null;
  const base = { ultima, ultimaOk, horasSinOk, datosHasta, ultimas24, conBitacora };
  if (!ultima) return { ...base, estado: "sin_datos", motivo: "La laptop no ha subido ninguna lectura en estos días." };

  const estado: EstadoGeneral =
    horasSinOk != null && horasSinOk < HORAS_ATRASADO ? "bien" : horasSinOk != null && horasSinOk < HORAS_SIN_LECTURA ? "atrasado" : "sin_lecturas";
  if (estado === "bien") return { ...base, estado, motivo: `Todo bien: la última lectura buena fue hace ${textoHoras(horasSinOk!)}.` };

  const desdeOk = horasSinOk == null ? "en estos días" : `en ${textoHoras(horasSinOk)}`;
  const horasUltima = horasEntre(ultima.en, ahora);
  let motivo: string;
  if (horasUltima >= HORAS_ATRASADO) {
    motivo = `Sin lectura buena ${desdeOk}. La laptop no ha corrido el colector desde hace ${textoHoras(horasUltima)}: ¿está apagada, dormida o sin internet?`;
  } else if (ultima.resultado === "sin_anillo") {
    motivo = `Sin lectura buena ${desdeOk}. La laptop corre cada hora pero no encuentra el anillo: acércalo, revisa su batería y el Bluetooth.`;
  } else if (ultima.resultado === "conexion_cortada") {
    motivo = `Sin lectura completa ${desdeOk}. El Bluetooth se corta a media descarga; lo bajado se guarda y la siguiente lectura sigue. Acerca el anillo a la laptop.`;
  } else if (ultima.resultado === "error") {
    motivo = `Sin lectura buena ${desdeOk}. El colector está fallando${ultima.mensaje ? `: ${ultima.mensaje}` : ""}. Revisa datos\\logs en la laptop.`;
  } else {
    motivo = `Sin lectura buena ${desdeOk}.`;
  }
  return { ...base, estado, motivo };
}

// ------------------------------------------------------- fallas recientes

export interface Falla {
  resultado: Exclude<Resultado, "ok">;
  mensaje: string | null;
  desde: string;
  hasta: string;
  veces: number;
}

/** Corridas que fallaron, de la más nueva a la más vieja; las seguidas con el
 * mismo resultado y mensaje van juntas ("12 veces, de 01:00 a 12:00") para
 * que una noche sin anillo no llene la lista. */
export function fallasRecientes(corridas: readonly Corrida[], maximo = 8): Falla[] {
  const salida: Falla[] = [];
  let actual: Falla | null = null;
  for (const c of corridas) {
    if (c.resultado === "ok") {
      actual = null;
      continue;
    }
    if (actual && actual.resultado === c.resultado && actual.mensaje === c.mensaje) {
      actual.hasta = c.en;
      actual.veces += 1;
    } else {
      actual = { resultado: c.resultado, mensaje: c.mensaje, desde: c.en, hasta: c.en, veces: 1 };
      salida.push(actual);
    }
  }
  return salida.reverse().slice(0, maximo);
}

// ------------------------------------------------------------ rejillas

/** Minutos vs. UTC del navegador en ese instante. */
export const offsetNavegador = (unix: number) => -new Date(unix * 1000).getTimezoneOffset();

/** Fecha y hora local de un instante con un desfase. */
export function fechaHoraLocal(unix: number, offset: number): { fecha: string; hora: number } {
  const d = new Date((unix + offset * 60) * 1000);
  return { fecha: d.toISOString().slice(0, 10), hora: d.getUTCHours() };
}

/** Las últimas `n` fechas terminando en `hoy`, de la más vieja a la más nueva. */
export function ultimasFechas(hoy: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => restarDias(hoy, n - 1 - i));
}

/** Estado de una hora en la rejilla de corridas: el mejor resultado de esa
 * hora, "sin_corrida" (la laptop no corrió: apagada, dormida) o "futuro". */
export type CeldaCorrida = Resultado | "sin_corrida" | "futuro";
const PRIORIDAD: Record<Resultado, number> = { ok: 4, conexion_cortada: 3, error: 2, sin_anillo: 1 };

export function rejillaCorridas(
  corridas: readonly Corrida[],
  fechas: readonly string[],
  ahora = new Date(),
  offsetDe: (unix: number) => number = offsetNavegador,
): Map<string, CeldaCorrida[]> {
  const mejor = new Map<string, Resultado>();
  for (const c of corridas) {
    const unix = Date.parse(c.en) / 1000;
    const { fecha, hora } = fechaHoraLocal(unix, c.offset ?? offsetDe(unix));
    const clave = `${fecha}|${hora}`;
    const previo = mejor.get(clave);
    if (!previo || PRIORIDAD[c.resultado] > PRIORIDAD[previo]) mejor.set(clave, c.resultado);
  }
  const ahoraUnix = ahora.getTime() / 1000;
  const local = fechaHoraLocal(ahoraUnix, offsetDe(ahoraUnix));
  const salida = new Map<string, CeldaCorrida[]>();
  for (const f of fechas) {
    salida.set(
      f,
      Array.from({ length: 24 }, (_, h) => {
        const r = mejor.get(`${f}|${h}`);
        if (r) return r;
        return f > local.fecha || (f === local.fecha && h > local.hora) ? "futuro" : "sin_corrida";
      }),
    );
  }
  return salida;
}

/** Estado de una hora de datos del anillo:
 * - puesto: hubo eventos y temperatura de piel (anillo en el dedo);
 * - quitado: el anillo midió, pero sin temperatura de piel (en la mesa o cargando);
 * - apagado: el anillo estuvo apagado (sin batería) casi toda la hora;
 * - sin_datos: no hay ningún evento de esa hora (hueco);
 * - pendiente: después del último dato que tiene la laptop (aún no se lee);
 * - sin_info: día subido por un colector anterior al v6 (sin conteo por hora);
 * - futuro. */
export type CeldaDatos = "puesto" | "quitado" | "apagado" | "sin_datos" | "pendiente" | "sin_info" | "futuro";

/** Un apagón cubre la hora si ocupa al menos la mitad. */
const MINUTOS_APAGON_HORA = 30;

export function rejillaDatos(
  dias: readonly DiaSalud[],
  fechas: readonly string[],
  datosHasta: number | null,
  ahora = new Date(),
  offsetDe: (unix: number) => number = offsetNavegador,
): Map<string, CeldaDatos[]> {
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  const ahoraUnix = ahora.getTime() / 1000;
  const salida = new Map<string, CeldaDatos[]>();
  for (const f of fechas) {
    const dia = porFecha.get(f);
    const medianoche = Date.parse(`${f}T00:00:00Z`) / 1000;
    const offset = dia?.utcOffset ?? offsetDe(medianoche + 12 * 3600);
    const inicioDia = medianoche - offset * 60;
    const conTemp = new Set((dia?.tempHoras ?? []).filter((t) => (t.n ?? 1) > 0).map((t) => t.hora));
    salida.set(
      f,
      Array.from({ length: 24 }, (_, h): CeldaDatos => {
        const inicio = inicioDia + h * 3600;
        const fin = inicio + 3600;
        if (inicio >= ahoraUnix) return "futuro";
        if (datosHasta != null && inicio >= datosHasta) return "pendiente";
        const apagado = (dia?.apagones ?? []).reduce((s, a) => s + Math.max(0, Math.min(fin, a.fin) - Math.max(inicio, a.inicio)), 0);
        if (apagado >= MINUTOS_APAGON_HORA * 60) return "apagado";
        if (dia && !dia.eventosHoras) return conTemp.has(h) ? "puesto" : "sin_info";
        const eventos = dia?.eventosHoras?.[h] ?? 0;
        if (eventos <= 0) return "sin_datos";
        return conTemp.has(h) ? "puesto" : "quitado";
      }),
    );
  }
  return salida;
}

export interface Hueco {
  fecha: string;
  hora: number;
  horas: number;
  tipo: "apagado" | "sin_datos";
}

/** Tramos seguidos (aunque crucen la medianoche) de horas apagado o sin datos
 * de al menos HORAS_HUECO_MINIMO, del más nuevo al más viejo. */
export function huecosDeDatos(rejilla: Map<string, CeldaDatos[]>, minimo = HORAS_HUECO_MINIMO): Hueco[] {
  const salida: Hueco[] = [];
  let actual: Hueco | null = null;
  for (const [fecha, celdas] of [...rejilla].sort(([a], [b]) => a.localeCompare(b))) {
    celdas.forEach((c, hora) => {
      if (c === "apagado" || c === "sin_datos") {
        if (actual && actual.tipo === c) actual.horas += 1;
        else {
          actual = { fecha, hora, horas: 1, tipo: c };
          salida.push(actual);
        }
      } else actual = null;
    });
  }
  return salida.filter((h) => h.horas >= minimo).reverse();
}

/** Horas con el anillo puesto / horas que ya pasaron con dato conocido. */
export function coberturaPuesto(rejilla: Map<string, CeldaDatos[]>): { puesto: number; total: number } {
  let puesto = 0;
  let total = 0;
  for (const celdas of rejilla.values()) {
    for (const c of celdas) {
      if (c === "futuro" || c === "pendiente" || c === "sin_info") continue;
      total += 1;
      if (c === "puesto") puesto += 1;
    }
  }
  return { puesto, total };
}
