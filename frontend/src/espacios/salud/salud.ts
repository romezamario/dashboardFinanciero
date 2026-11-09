// Espacio Salud (Mario, 2026-11-08): datos del anillo Oura que sube el
// colector de la laptop (repo romezamario/oura, colector/subir_oura.py). Viven
// en el esquema `salud` de Supabase, aparte de Finanzas (`public`); ver
// supabase/espacios/salud. Aquí: lectura + funciones puras de las gráficas.
import { supabase } from "../../lib/supabase";

// ------------------------------------------------------------------ tipos

/** Fases como las codifica open_health (STAGE en su dashboard). */
export type Fase = 1 | 2 | 3 | 4;
export const NOMBRE_FASE: Record<Fase, string> = { 1: "Profundo", 2: "Ligero", 3: "REM", 4: "Despierto" };
/** Orden de abajo hacia arriba en las barras apiladas y en la leyenda. */
export const ORDEN_FASES: Fase[] = [1, 2, 3, 4];
/** Paleta validada (skill dataviz, claro y oscuro): azul / verde / ámbar en
 * ese orden de adyacencia, y gris neutro para "despierto" (no es una fase de
 * sueño). Siempre con leyenda y etiquetas. */
export const COLOR_FASE: Record<Fase, string> = {
  1: "var(--series-1)",
  2: "var(--series-3)",
  3: "var(--series-4)",
  4: "var(--text-muted)",
};

export interface Noche {
  ymd?: string;
  wake_ymd?: string;
  start?: string;
  end?: string;
  start_unix?: number;
  end_unix?: number;
  in_bed_h?: number | null;
  rhr?: number | null;
  hrv_ms?: number | null;
  skin_temp?: number | null;
  spo2_mean?: number | null;
  breath_rate?: number | null;
  deep_pct?: number | null;
  light_pct?: number | null;
  rem_pct?: number | null;
  wake_pct?: number | null;
  efficiency?: number | null;
  stages?: number[] | null;
  metrics?: { asleep_min?: number | null; awakenings?: number | null } | null;
  sleep_score?: { score?: number | null } | null;
  series_t?: { hr?: [number, number][]; hrv?: [number, number][] } | null;
}

export interface DeudaSueno {
  total_sleep_min?: number | null;
  sleep_need_min?: number | null;
  shortfall_min?: number | null;
  cumulative_debt_min?: number | null;
}

export interface Actividad {
  steps?: number | null;
  active_kcal?: number | null;
  total_kcal?: number | null;
  distance_m?: number | null;
}

export interface HoraHR {
  hora: number;
  mediana: number;
  min?: number | null;
  max?: number | null;
  bajo?: number | null;
  alto?: number | null;
  latidos?: number | null;
}

export interface DiaSalud {
  fecha: string;
  noche?: Noche;
  deuda?: DeudaSueno;
  actividad?: Actividad;
  hrHoras?: HoraHR[];
}

// --------------------------------------------------------------- lectura

interface FilaResumen {
  fecha: string;
  datos: { noche?: Noche; deuda_sueno?: DeudaSueno; actividad?: Actividad; hr_horas?: HoraHR[] } | null;
}

export function filaADia({ fecha, datos }: FilaResumen): DiaSalud {
  const d = datos ?? {};
  return { fecha, noche: d.noche, deuda: d.deuda_sueno, actividad: d.actividad, hrHoras: d.hr_horas };
}

/** Todos los días (fuente 'oura'), del más antiguo al más reciente. Son pocas
 * filas (una por día), así que basta con una página grande. */
export async function obtenerDiasSalud(): Promise<DiaSalud[]> {
  const { data, error } = await supabase
    .schema("salud")
    .from("resumen_diario")
    .select("fecha, datos")
    .eq("fuente", "oura")
    .order("fecha", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return ((data ?? []) as FilaResumen[]).map(filaADia);
}

export async function obtenerUltimaSubida(): Promise<string | null> {
  const { data, error } = await supabase
    .schema("salud")
    .from("oura_sincronizaciones")
    .select("subida_en")
    .eq("origen", "laptop")
    .order("subida_en", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as { subida_en?: string } | undefined)?.subida_en ?? null;
}

// ------------------------------------------------------------ batería

export interface LecturaBateria {
  pct: number;
  /** ISO. */
  en: string;
  cargando: boolean | null;
  origen: "laptop" | "navegador";
}

/** Lecturas de batería de las últimas 48 h (cada lectura horaria de la laptop
 * y cada prueba desde el navegador), de la más antigua a la más reciente. */
export async function obtenerBateria(ahora = new Date()): Promise<LecturaBateria[]> {
  const desde = new Date(ahora.getTime() - 48 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .schema("salud")
    .from("oura_sincronizaciones")
    .select("bateria_pct, bateria_leida_en, cargando, origen")
    .not("bateria_pct", "is", null)
    .gte("bateria_leida_en", desde)
    .order("bateria_leida_en", { ascending: true })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as { bateria_pct: number; bateria_leida_en: string; cargando: boolean | null; origen: LecturaBateria["origen"] }[]).map(
    (f) => ({ pct: f.bateria_pct, en: f.bateria_leida_en, cargando: f.cargando, origen: f.origen })
  );
}

/** Guarda una lectura de batería hecha desde este navegador (prueba de Bluefy). */
export async function guardarBateriaNavegador(pct: number, cargando: boolean): Promise<void> {
  const { error } = await supabase.schema("salud").from("oura_sincronizaciones").insert({
    origen: "navegador",
    eventos_enviados: 0,
    bateria_pct: pct,
    bateria_leida_en: new Date().toISOString(),
    cargando,
  });
  if (error) throw error;
}

export type NivelBateria = "ok" | "baja" | "critica";

/** < 10% crítica (rojo), < 20% baja (amarillo). */
export function nivelBateria(pct: number): NivelBateria {
  return pct < 10 ? "critica" : pct < 20 ? "baja" : "ok";
}

/** "hace 20 min", "hace 3 h", "hace 2 días". */
export function haceCuanto(iso: string, ahora = new Date()): string {
  const min = Math.max(0, Math.round((ahora.getTime() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** Gasto por día (avisos de compra por correo, `public.gastos_correo`) en el
 * rango dado, para el cruce Salud × Finanzas. */
export async function obtenerGastoPorDia(desde: string, hasta: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("gastos_correo")
    .select("fecha, monto")
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .limit(10000);
  if (error) throw error;
  return sumarPorFecha((data ?? []) as { fecha: string; monto: number }[]);
}

export function sumarPorFecha(filas: readonly { fecha: string; monto: number }[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const { fecha, monto } of filas) total.set(fecha, (total.get(fecha) ?? 0) + Number(monto || 0));
  return total;
}

/** Mensaje para la persona según el error de Supabase. PGRST106 = el esquema
 * no está expuesto en la API (la migración del espacio aún no corre). */
export function mensajeErrorSalud(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code === "PGRST106" || /schema must be one of/i.test(error?.message ?? "")) {
    return "El espacio Salud todavía no está activado en Supabase: falta aplicar su migración.";
  }
  return "No se pudieron cargar los datos de salud. Intenta de nuevo.";
}

// ----------------------------------------------------------- utilidades

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function promedio(valores: readonly number[]): number | null {
  return valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
}

function desviacionEstandar(valores: readonly number[]): number | null {
  const m = promedio(valores);
  if (m === null || valores.length < 2) return null;
  return Math.sqrt(valores.reduce((a, v) => a + (v - m) ** 2, 0) / (valores.length - 1));
}

/** Fecha ISO de hace `dias` días respecto a `hoy` (ISO). */
export function restarDias(hoy: string, dias: number): string {
  const d = new Date(`${hoy}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** Días dentro de los últimos `n` días contando el más reciente con datos. */
export function ultimosDias(dias: readonly DiaSalud[], n: number): DiaSalud[] {
  const ultimo = dias.at(-1)?.fecha;
  if (!ultimo) return [];
  const desde = restarDias(ultimo, n - 1);
  return dias.filter((d) => d.fecha >= desde);
}

/** Minutos dormidos de una noche: el dato medido o, si falta, en cama × (1 − despierto). */
export function minutosDormido(n: Noche | undefined): number | null {
  if (!n) return null;
  const medido = num(n.metrics?.asleep_min);
  if (medido !== null) return medido;
  const cama = num(n.in_bed_h);
  const despierto = num(n.wake_pct);
  return cama === null ? null : Math.round(cama * 60 * (1 - (despierto ?? 0) / 100));
}

// --------------------------------------------------------- 1. tarjetas hoy

export type ClaveMetrica = "sueno" | "eficiencia" | "rhr" | "hrv" | "temp" | "deuda" | "pasos";

export interface Metrica {
  clave: ClaveMetrica;
  nombre: string;
  unidad: string;
  /** true = más alto es mejor (para el color del cambio). null = neutral. */
  mejorAlto: boolean | null;
  leer: (d: DiaSalud) => number | null;
}

export const METRICAS: readonly Metrica[] = [
  { clave: "sueno", nombre: "Sueño", unidad: "min", mejorAlto: true, leer: (d) => minutosDormido(d.noche) },
  { clave: "eficiencia", nombre: "Eficiencia", unidad: "%", mejorAlto: true, leer: (d) => num(d.noche?.efficiency) },
  { clave: "rhr", nombre: "HR en reposo", unidad: "lpm", mejorAlto: false, leer: (d) => num(d.noche?.rhr) },
  { clave: "hrv", nombre: "HRV", unidad: "ms", mejorAlto: true, leer: (d) => num(d.noche?.hrv_ms) },
  { clave: "temp", nombre: "Temperatura", unidad: "°C", mejorAlto: null, leer: (d) => num(d.noche?.skin_temp) },
  { clave: "deuda", nombre: "Faltó dormir", unidad: "min", mejorAlto: false, leer: (d) => num(d.deuda?.shortfall_min) },
  { clave: "pasos", nombre: "Pasos", unidad: "", mejorAlto: true, leer: (d) => num(d.actividad?.steps) },
];

export interface Tarjeta {
  metrica: Metrica;
  valor: number | null;
  fecha: string | null;
  /** Promedio de hasta 7 días anteriores con dato; null sin historial. */
  normal: number | null;
  cambio: number | null;
}

/** Valor más reciente de cada métrica contra su promedio de los 7 días con
 * dato anteriores. */
export function tarjetasHoy(dias: readonly DiaSalud[]): Tarjeta[] {
  return METRICAS.map((metrica) => {
    const conDato = dias
      .map((d) => ({ fecha: d.fecha, v: metrica.leer(d) }))
      .filter((x): x is { fecha: string; v: number } => x.v !== null);
    const ultimo = conDato.at(-1);
    if (!ultimo) return { metrica, valor: null, fecha: null, normal: null, cambio: null };
    const normal = promedio(conDato.slice(-8, -1).map((x) => x.v));
    return { metrica, valor: ultimo.v, fecha: ultimo.fecha, normal, cambio: normal === null ? null : ultimo.v - normal };
  });
}

// ---------------------------------------------------------- 2. hipnograma

export interface Segmento {
  inicio: number; // unix s
  fin: number;
  fase: Fase;
}

/** Une las celdas de `stages` (repartidas a partes iguales entre la hora de
 * dormir y la de despertar) en tramos continuos por fase. */
export function segmentosHipnograma(n: Noche | undefined): Segmento[] {
  const fases = n?.stages ?? [];
  const ini = num(n?.start_unix);
  const fin = num(n?.end_unix);
  if (!fases.length || ini === null || fin === null || fin <= ini) return [];
  const paso = (fin - ini) / fases.length;
  const tramos: Segmento[] = [];
  fases.forEach((f, i) => {
    if (![1, 2, 3, 4].includes(f)) return;
    const fase = f as Fase;
    const t0 = ini + i * paso;
    const previo = tramos.at(-1);
    if (previo && previo.fase === fase && Math.abs(previo.fin - t0) < 1e-6) previo.fin = t0 + paso;
    else tramos.push({ inicio: t0, fin: t0 + paso, fase });
  });
  return tramos;
}

// ------------------------------------------------------ 3. HR de la noche

export function serieNoche(n: Noche | undefined, clave: "hr" | "hrv"): { t: number; valor: number }[] {
  return (n?.series_t?.[clave] ?? [])
    .filter((p) => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null)
    .map(([t, valor]) => ({ t, valor }));
}

export interface Extremo {
  t: number;
  valor: number;
}

/** Mínimo (HR) o máximo (HRV) SOSTENIDO de la noche: se busca sobre la mediana
 * de cada lectura con sus vecinas (ventana de 3, ~15 min con lecturas cada
 * 5 min), así un solo valor atípico —un artefacto del sensor— no se vuelve el
 * extremo. Se reporta esa mediana y la hora de la lectura central. Con menos
 * de 3 lecturas, el valor tal cual. */
export function extremoNoche(datos: readonly { t: number; valor: number }[], tipo: "min" | "max"): Extremo | null {
  if (!datos.length) return null;
  const mediana3 = (i: number) => {
    const v = [datos[i - 1]?.valor, datos[i].valor, datos[i + 1]?.valor]
      .filter((x): x is number => x !== undefined)
      .sort((a, b) => a - b);
    // En las orillas solo hay 2 lecturas: se toma la menos extrema, para que
    // un pico al principio o al final tampoco cuente.
    if (v.length === 2) return tipo === "max" ? v[0] : v[1];
    return v.length === 3 ? v[1] : v[0];
  };
  const suaves = datos.map((p, i) => ({ t: p.t, valor: datos.length >= 3 ? mediana3(i) : p.valor }));
  return suaves.reduce((mejor, p) => ((tipo === "min" ? p.valor < mejor.valor : p.valor > mejor.valor) ? p : mejor));
}

// ------------------------------------------------- 4. fases por noche

export interface FasesNoche {
  fecha: string;
  profundo: number;
  ligero: number;
  rem: number;
  despierto: number;
  /** Deuda acumulada (min) hasta esa noche. */
  deudaAcumulada: number | null;
}

/** Minutos por fase de cada noche (en cama × % de la fase) y la deuda de
 * sueño acumulada: la de oura.exe si la calcula, si no la suma de lo que faltó. */
export function fasesPorNoche(dias: readonly DiaSalud[]): FasesNoche[] {
  let suma = 0;
  return dias
    .filter((d) => num(d.noche?.in_bed_h) !== null)
    .map((d) => {
      const n = d.noche as Noche;
      const cama = (n.in_bed_h as number) * 60;
      const min = (pct: number | null | undefined) => Math.round((cama * (num(pct) ?? 0)) / 100);
      const faltante = num(d.deuda?.shortfall_min);
      if (faltante !== null) suma = Math.max(0, suma + faltante);
      return {
        fecha: d.fecha,
        profundo: min(n.deep_pct),
        ligero: min(n.light_pct),
        rem: min(n.rem_pct),
        despierto: min(n.wake_pct),
        deudaAcumulada: num(d.deuda?.cumulative_debt_min) ?? (faltante === null ? null : suma),
      };
    });
}

// ------------------------------------------ 5/6. tendencias con banda normal

export interface PuntoTendencia {
  fecha: string;
  valor: number | null;
  /** Banda normal: promedio ± 1 desviación de los 30 días anteriores (≥ 3 datos). */
  base: number | null;
  bajo: number | null;
  alto: number | null;
}

export function tendencia(dias: readonly DiaSalud[], leer: (d: DiaSalud) => number | null): PuntoTendencia[] {
  return dias.map((d, i) => {
    const previos = dias
      .slice(0, i)
      .filter((p) => p.fecha >= restarDias(d.fecha, 30))
      .map(leer)
      .filter((v): v is number => v !== null);
    const base = previos.length >= 3 ? promedio(previos) : null;
    const sd = previos.length >= 3 ? desviacionEstandar(previos) : null;
    return {
      fecha: d.fecha,
      valor: leer(d),
      base,
      bajo: base !== null && sd !== null ? base - sd : null,
      alto: base !== null && sd !== null ? base + sd : null,
    };
  });
}

/** Temperatura de cada noche menos tu línea base (promedio de los 30 días
 * anteriores, ≥ 3 noches). null mientras no hay línea base. */
export function desviacionTemperatura(dias: readonly DiaSalud[]): { fecha: string; desviacion: number | null }[] {
  return tendencia(dias, (d) => num(d.noche?.skin_temp))
    .filter((p) => p.valor !== null)
    .map((p) => ({
      fecha: p.fecha,
      desviacion: p.base === null ? null : Math.round(((p.valor as number) - p.base) * 100) / 100,
    }));
}

// --------------------------------------------------- 7. horario de sueño

/** Hora de dormir y de despertar en minutos desde las 18:00 (así una noche
 * que cruza la medianoche es un tramo continuo). */
export function horarioSueno(dias: readonly DiaSalud[]): { fecha: string; rango: [number, number] }[] {
  const desde18 = (hm?: string) => {
    if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return null;
    const [h, m] = hm.split(":").map(Number);
    return (((h - 18 + 24) % 24) * 60 + m) % 1440;
  };
  return dias.flatMap((d) => {
    const a = desde18(d.noche?.start);
    let b = desde18(d.noche?.end);
    if (a === null || b === null) return [];
    if (b <= a) b += 1440;
    return [{ fecha: d.fecha, rango: [a, b] as [number, number] }];
  });
}

export function relojDesde18(minutos: number): string {
  const total = (minutos + 18 * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// --------------------------------------------- 9/10. HR del día (día × hora)

export interface CeldaHR {
  fecha: string;
  hora: number;
  mediana: number;
}

export function celdasHR(dias: readonly DiaSalud[]): CeldaHR[] {
  return dias.flatMap((d) =>
    (d.hrHoras ?? [])
      .filter((h) => num(h.mediana) !== null && num(h.hora) !== null)
      .map((h) => ({ fecha: d.fecha, hora: h.hora, mediana: h.mediana }))
  );
}

// ------------------------------------------- 11. cruce Salud × Finanzas

export function cruceSuenoGasto(
  dias: readonly DiaSalud[],
  gasto: ReadonlyMap<string, number>
): { fecha: string; horas: number; gasto: number }[] {
  return dias.flatMap((d) => {
    const min = minutosDormido(d.noche);
    if (min === null) return [];
    return [{ fecha: d.fecha, horas: Math.round((min / 60) * 10) / 10, gasto: gasto.get(d.fecha) ?? 0 }];
  });
}
