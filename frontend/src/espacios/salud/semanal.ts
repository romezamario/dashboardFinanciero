// Resumen semanal (Mario, 2026-11-14: "cada domingo, un resumen de sueño,
// recuperación y estrés con lo que mejoró y lo que empeoró"). Semanas de lunes
// a domingo; el domingo ya se ve la semana que termina ese día. Se compara
// contra la semana anterior con los mismos lectores que la vista de viaje.
import type { DiaEstres } from "./indicadores";
import { restarDias, type DiaSalud } from "./salud";
import { lectoresDia, promedioTramo, veredicto, type ClaveEfecto, type ValorTramo, type Veredicto } from "./viajes";

/** Días con dato mínimos en cada semana para comparar una métrica. */
export const MINIMO_DIAS_SEMANA = 3;

/** Lunes (AAAA-MM-DD) de la semana de `fecha`. */
export function lunesDe(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return restarDias(fecha, (dia + 6) % 7);
}

/** La semana a resumir hoy: la que termina este domingo si hoy es domingo; si
 * no, la que terminó el domingo pasado. */
export function semanaParaResumir(hoy: string): string {
  const lunes = lunesDe(hoy);
  return new Date(`${hoy}T00:00:00Z`).getUTCDay() === 0 ? lunes : restarDias(lunes, 7);
}

export const domingoDe = (lunes: string) => restarDias(lunes, -6);

export type Grupo = "Sueño" | "Recuperación" | "Estrés";

const GRUPO: Record<ClaveEfecto, Grupo> = {
  sueno: "Sueño",
  dormir: "Sueño",
  hrv: "Recuperación",
  rhr: "Recuperación",
  recuperacion: "Recuperación",
  estres: "Estrés",
};

export interface CambioSemana {
  clave: ClaveEfecto;
  grupo: Grupo;
  nombre: string;
  actual: ValorTramo;
  anterior: ValorTramo;
  veredicto: Veredicto;
}

export interface ResumenSemana {
  lunes: string;
  domingo: string;
  cambios: CambioSemana[];
  /** Días de la semana con alguna noche. */
  noches: number;
}

export function resumenSemanal(dias: readonly DiaSalud[], estres: readonly DiaEstres[], lunes: string): ResumenSemana {
  const domingo = domingoDe(lunes);
  const antes = restarDias(lunes, 7);
  const cambios = lectoresDia(dias, estres).map((l) => {
    const actual = promedioTramo(dias, lunes, domingo, l.leer);
    const anterior = promedioTramo(dias, antes, restarDias(lunes, 1), l.leer);
    return {
      clave: l.clave,
      grupo: GRUPO[l.clave],
      nombre: l.nombre,
      actual,
      anterior,
      veredicto: veredicto(l.clave, l.mejorAlto, anterior, actual, MINIMO_DIAS_SEMANA),
    };
  });
  const noches = dias.filter((d) => d.noche && d.fecha >= lunes && d.fecha <= domingo).length;
  return { lunes, domingo, cambios, noches };
}

/** Lunes de las semanas que tienen al menos un día con datos, de la más antigua a la más reciente. */
export function semanasConDatos(dias: readonly DiaSalud[]): string[] {
  return [...new Set(dias.map((d) => lunesDe(d.fecha)))].sort();
}
