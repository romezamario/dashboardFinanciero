// Resumen semanal (Mario, 2026-11-14: "cada domingo, un resumen de sueño,
// recuperación y estrés con lo que mejoró y lo que empeoró"). Semanas de lunes
// a domingo; el domingo ya se ve la semana que termina ese día. Se compara
// contra la semana anterior con los mismos lectores que la vista de viaje.
import type { DiaEstres } from "./indicadores";
import { relojDesde18, restarDias, type DiaSalud } from "./salud";
import { horasMin } from "./formatoSalud";
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

// Texto de cada valor y de su cambio (pestaña Semana, viajes y el correo semanal).
export function formato(clave: ClaveEfecto, v: number | null): string {
  if (v === null) return "—";
  if (clave === "sueno") return horasMin(v);
  if (clave === "dormir") return relojDesde18(Math.round(v) % 1440);
  if (clave === "estres") return `${Math.round(v)}%`;
  return `${Math.round(v)}`;
}

export function diferencia(clave: ClaveEfecto, antes: number | null, ahora: number | null): string | null {
  if (antes === null || ahora === null) return null;
  const d = ahora - antes;
  if (clave === "dormir") {
    const m = Math.round(Math.abs(d));
    const texto = m < 60 ? `${m} min` : horasMin(m).replace(" 00 min", "");
    return m < 5 ? "a la misma hora" : `${texto} ${d > 0 ? "más tarde" : "más temprano"}`;
  }
  const signo = d > 0 ? "+" : d < 0 ? "−" : "±";
  if (clave === "sueno") return `${signo}${Math.round(Math.abs(d))} min`;
  if (clave === "estres") return `${signo}${Math.round(Math.abs(d))} pts`;
  return `${signo}${Math.round(Math.abs(d))}`;
}

