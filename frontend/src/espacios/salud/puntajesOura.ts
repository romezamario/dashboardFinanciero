// Puntajes de la app de Oura (Mario, 2026-11-19: "sí guarda los puntajes en el
// dashboard"). Vienen del historial importado de la app (`datos.oura_app`, fuente
// 'oura_app', 2025-01-31 → 2026-11-08): los calculó la nube de Oura, no nosotros.
// Después de esa fecha no hay más (el anillo ya se lee solo por Bluetooth y esos
// modelos no los tenemos); las puntuaciones propias están en puntuaciones.ts.
import type { DiaSalud, ExtrasOuraApp } from "./salud";
import { restarDias } from "./salud";
import { lunesDe } from "./semanal";

export type ClavePuntaje = "puntaje_sueno" | "preparacion" | "puntaje_actividad";

export const PUNTAJES: readonly { clave: ClavePuntaje; texto: string; color: string }[] = [
  { clave: "puntaje_sueno", texto: "Sueño", color: "var(--series-1)" },
  { clave: "preparacion", texto: "Preparación", color: "var(--series-2)" },
  { clave: "puntaje_actividad", texto: "Actividad", color: "var(--series-3)" },
];

/** Estrés del día según Oura (`day_summary`). */
export const ESTRES_OURA = {
  stressful: { texto: "Estresante", color: "var(--series-2)" },
  normal: { texto: "Normal", color: "var(--text-muted)" },
  restored: { texto: "Recuperado", color: "var(--series-1)" },
} as const;
export type EstresOura = keyof typeof ESTRES_OURA;
const ORDEN_ESTRES: EstresOura[] = ["restored", "normal", "stressful"];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const promedio = (vs: number[]) => (vs.length ? Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10 : null);

/** Días con algún dato de la app de Oura, del más antiguo al más reciente. */
export function diasConPuntajesOura(dias: readonly DiaSalud[]): (DiaSalud & { ouraApp: ExtrasOuraApp })[] {
  return dias.filter((d): d is DiaSalud & { ouraApp: ExtrasOuraApp } => !!d.ouraApp && Object.keys(d.ouraApp).length > 0);
}

/** Los días de los últimos `n` días contados desde el último con datos (n = null: todos). */
export function ultimosDeOura<T extends { fecha: string }>(dias: readonly T[], n: number | null): T[] {
  const ultimo = dias.at(-1)?.fecha;
  if (!ultimo || n === null) return [...dias];
  const desde = restarDias(ultimo, n - 1);
  return dias.filter((d) => d.fecha >= desde);
}

export interface SemanaPuntajes {
  /** Lunes de la semana. */
  semana: string;
  puntaje_sueno: number | null;
  preparacion: number | null;
  puntaje_actividad: number | null;
}

/** Promedio por semana (lunes a domingo) de cada puntaje: por día hay demasiado
 * ruido para un año entero. */
export function puntajesPorSemana(dias: readonly { fecha: string; ouraApp?: ExtrasOuraApp }[]): SemanaPuntajes[] {
  const semanas = new Map<string, Record<ClavePuntaje, number[]>>();
  for (const d of dias) {
    const s = lunesDe(d.fecha);
    const acc = semanas.get(s) ?? { puntaje_sueno: [], preparacion: [], puntaje_actividad: [] };
    for (const { clave } of PUNTAJES) {
      const v = num(d.ouraApp?.[clave]);
      if (v !== null) acc[clave].push(v);
    }
    semanas.set(s, acc);
  }
  return [...semanas]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([semana, acc]) => ({
      semana,
      puntaje_sueno: promedio(acc.puntaje_sueno),
      preparacion: promedio(acc.preparacion),
      puntaje_actividad: promedio(acc.puntaje_actividad),
    }))
    .filter((s) => PUNTAJES.some(({ clave }) => s[clave] !== null));
}

export interface ValorConFecha {
  fecha: string;
  valor: number;
}

export interface ResumenOura {
  desde: string;
  hasta: string;
  promedios: Record<ClavePuntaje, number | null>;
  /** Último VO2 máx. del periodo y cuánto cambió desde el primero. */
  vo2max: { ultimo: ValorConFecha; cambio: number | null } | null;
  edadCardiovascular: { ultimo: ValorConFecha; cambio: number | null } | null;
  /** Días por estado de estrés y su %. */
  estres: { estado: EstresOura; dias: number; pct: number }[];
}

function serie(dias: readonly { fecha: string; ouraApp?: ExtrasOuraApp }[], clave: keyof ExtrasOuraApp): ValorConFecha[] {
  return dias.flatMap((d) => {
    const v = num(d.ouraApp?.[clave]);
    return v === null ? [] : [{ fecha: d.fecha, valor: v }];
  });
}

function ultimoYCambio(s: ValorConFecha[]) {
  if (!s.length) return null;
  const ultimo = s.at(-1)!;
  return { ultimo, cambio: s.length > 1 ? Math.round((ultimo.valor - s[0].valor) * 10) / 10 : null };
}

export function resumenOura(dias: readonly { fecha: string; ouraApp?: ExtrasOuraApp }[]): ResumenOura | null {
  if (!dias.length) return null;
  const promedios = Object.fromEntries(
    PUNTAJES.map(({ clave }) => [clave, promedio(serie(dias, clave).map((p) => p.valor))]),
  ) as Record<ClavePuntaje, number | null>;
  const conteo = new Map<EstresOura, number>();
  for (const d of dias) {
    const e = d.ouraApp?.estres_dia;
    if (e && e in ESTRES_OURA) conteo.set(e as EstresOura, (conteo.get(e as EstresOura) ?? 0) + 1);
  }
  const total = [...conteo.values()].reduce((a, b) => a + b, 0);
  return {
    desde: dias[0].fecha,
    hasta: dias.at(-1)!.fecha,
    promedios,
    vo2max: ultimoYCambio(serie(dias, "vo2max")),
    edadCardiovascular: ultimoYCambio(serie(dias, "edad_cardiovascular")),
    estres: total
      ? ORDEN_ESTRES.map((estado) => ({ estado, dias: conteo.get(estado) ?? 0, pct: Math.round(((conteo.get(estado) ?? 0) / total) * 100) }))
      : [],
  };
}

export interface MesEstres {
  mes: string;
  restored: number;
  normal: number;
  stressful: number;
}

/** Días de cada estado de estrés por mes (AAAA-MM). */
export function estresPorMes(dias: readonly { fecha: string; ouraApp?: ExtrasOuraApp }[]): MesEstres[] {
  const meses = new Map<string, MesEstres>();
  for (const d of dias) {
    const e = d.ouraApp?.estres_dia;
    if (!e || !(e in ESTRES_OURA)) continue;
    const mes = d.fecha.slice(0, 7);
    const m = meses.get(mes) ?? { mes, restored: 0, normal: 0, stressful: 0 };
    m[e as EstresOura] += 1;
    meses.set(mes, m);
  }
  return [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

/** VO2 máx. y edad cardiovascular cambian lento: una lectura por semana (la última). */
export function seriesSemanales(dias: readonly { fecha: string; ouraApp?: ExtrasOuraApp }[]) {
  const semanas = new Map<string, { semana: string; vo2max: number | null; edad: number | null }>();
  for (const d of dias) {
    const s = lunesDe(d.fecha);
    const p = semanas.get(s) ?? { semana: s, vo2max: null, edad: null };
    p.vo2max = num(d.ouraApp?.vo2max) ?? p.vo2max;
    p.edad = num(d.ouraApp?.edad_cardiovascular) ?? p.edad;
    semanas.set(s, p);
  }
  return [...semanas.values()].sort((a, b) => a.semana.localeCompare(b.semana));
}
