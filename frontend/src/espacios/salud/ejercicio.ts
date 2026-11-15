// Sesiones de ejercicio (Mario, 2026-11-15: "¿puedes detectar cuando hago
// ejercicio?"). El colector (repo oura, oura_local.sesiones_ejercicio) las
// detecta en la laptop: minutos seguidos con MET ≥ 3 (moderado) o ≥ 6
// (vigoroso). Aquí solo se resumen. Es una detección propia, no la de Oura:
// no sabe qué deporte fue, y una caminata rápida de 10 min también cuenta.
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

export interface ResumenEjercicio {
  sesiones: number;
  minutos: number;
  kcal: number | null;
  /** Minutos "equivalentes" por semana: moderados + 2 × vigorosos. */
  equivalentesPorSemana: number;
  semanas: number;
}

const DIA_MS = 86400000;

/** Resumen del periodo. Las semanas se cuentan entre el primer y el último
 * día CON DATOS del periodo (≥ 1), para no dividir entre días que no existen. */
export function resumenEjercicio(dias: readonly DiaSalud[]): ResumenEjercicio | null {
  if (!dias.length) return null;
  const sesiones = dias.flatMap((d) => d.ejercicio ?? []);
  const dur = Date.parse(dias.at(-1)!.fecha) - Date.parse(dias[0].fecha);
  const semanas = Math.max(1, (dur / DIA_MS + 1) / 7);
  const equivalentes = sesiones.reduce((t, s) => t + s.min_moderados + 2 * s.min_vigorosos, 0);
  const conKcal = sesiones.filter((s) => typeof s.kcal === "number");
  return {
    sesiones: sesiones.length,
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
