// Reporte semanal (Mario, 2026-11-18: "reporte semanal automático cada lunes";
// 2026-11-19: "no lo quiero a Gmail, lo quiero directo en el dashboard"). Es la
// pestaña Semana (semanal.ts) + actividad y ejercicio de la semana; se calcula
// al abrirla. Aquí solo funciones puras (probadas en reporteSemanal.test.ts).
import { META_SEMANAL_MIN, sinDescartadas, type EtiquetaEjercicio } from "./ejercicio";
import type { DiaEstres } from "./indicadores";
import { num, promedio, restarDias, type DiaSalud } from "./salud";
import { diferencia, domingoDe, formato, MINIMO_DIAS_SEMANA, resumenSemanal } from "./semanal";
import type { Veredicto } from "./viajes";

export type GrupoReporte = "Sueño" | "Recuperación" | "Estrés" | "Actividad" | "Ejercicio";
export const ORDEN_GRUPOS: readonly GrupoReporte[] = ["Sueño", "Recuperación", "Estrés", "Actividad", "Ejercicio"];

export interface FilaReporte {
  grupo: GrupoReporte;
  nombre: string;
  actual: string;
  /** Días con dato esta semana (null = total de la semana, no promedio). */
  diasActual: number | null;
  anterior: string;
  cambio: string | null;
  veredicto: Veredicto;
}

export interface EjercicioSemana {
  sesiones: number;
  minutos: number;
  /** Moderados + 2 × vigorosos (la cuenta de la OMS). */
  equivalentes: number;
  /** Días de la semana con algún dato del anillo. */
  diasConDatos: number;
}

export interface ReporteSemanal {
  lunes: string;
  domingo: string;
  noches: number;
  diasConDatos: number;
  filas: FilaReporte[];
  ejercicio: EjercicioSemana;
  ejercicioAnterior: EjercicioSemana;
}

/** Cambio mínimo para dejar de ser "igual" en lo que no está en la pestaña Semana. */
export const UMBRAL_REPORTE = { pasos: 1000, kcal: 50, equivalentes: 20, sesiones: 1 } as const;

const mil = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

function veredictoSimple(mejorAlto: boolean, antes: number | null, ahora: number | null, umbral: number, valido: boolean): Veredicto {
  if (!valido || antes === null || ahora === null) return "sin-dato";
  const d = ahora - antes;
  if (Math.abs(d) < umbral) return "igual";
  return (d > 0) === mejorAlto ? "mejor" : "peor";
}

const conSigno = (d: number, unidad = "") => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${mil.format(Math.abs(Math.round(d)))}${unidad}`;

function ejercicioDe(dias: readonly DiaSalud[], desde: string, hasta: string): EjercicioSemana {
  const semana = dias.filter((d) => d.fecha >= desde && d.fecha <= hasta);
  const sesiones = semana.flatMap((d) => d.ejercicio ?? []);
  return {
    sesiones: sesiones.length,
    minutos: sesiones.reduce((t, s) => t + s.duracion_min, 0),
    equivalentes: sesiones.reduce((t, s) => t + s.min_moderados + 2 * s.min_vigorosos, 0),
    diasConDatos: semana.length,
  };
}

function filaPromedio(
  dias: readonly DiaSalud[],
  lunes: string,
  nombre: string,
  leer: (d: DiaSalud) => number | null,
  umbral: number,
  unidad: string,
): FilaReporte {
  const tramo = (desde: string, hasta: string) => {
    const v = dias.filter((d) => d.fecha >= desde && d.fecha <= hasta).map(leer).filter((x): x is number => x !== null);
    return { valor: promedio(v), n: v.length };
  };
  const actual = tramo(lunes, domingoDe(lunes));
  const anterior = tramo(restarDias(lunes, 7), restarDias(lunes, 1));
  const texto = (v: number | null) => (v === null ? "—" : `${mil.format(Math.round(v))}${unidad}`);
  return {
    grupo: "Actividad",
    nombre,
    actual: texto(actual.valor),
    diasActual: actual.n,
    anterior: texto(anterior.valor),
    cambio: actual.valor === null || anterior.valor === null ? null : conSigno(actual.valor - anterior.valor),
    veredicto: veredictoSimple(true, anterior.valor, actual.valor, umbral, actual.n >= MINIMO_DIAS_SEMANA && anterior.n >= MINIMO_DIAS_SEMANA),
  };
}

/** Todo el reporte de la semana que empieza en `lunes`. `dias` debe traer
 * al menos ~5 semanas antes (la recuperación y el estrés se miden contra tu
 * normal de los días previos). */
export function armarReporte(
  dias: readonly DiaSalud[],
  estres: readonly DiaEstres[],
  etiquetas: readonly EtiquetaEjercicio[],
  lunes: string,
): ReporteSemanal {
  const domingo = domingoDe(lunes);
  const semana = resumenSemanal(dias, estres, lunes);
  const filas: FilaReporte[] = semana.cambios.map((c) => ({
    grupo: c.grupo,
    nombre: c.nombre.replace(/ \(min\)$/, ""),
    actual: formato(c.clave, c.actual.valor),
    diasActual: c.actual.n,
    anterior: formato(c.clave, c.anterior.valor),
    cambio: diferencia(c.clave, c.anterior.valor, c.actual.valor),
    veredicto: c.veredicto,
  }));
  filas.push(
    filaPromedio(dias, lunes, "Pasos por día", (d) => num(d.actividad?.steps), UMBRAL_REPORTE.pasos, ""),
    filaPromedio(dias, lunes, "Calorías activas por día", (d) => num(d.actividad?.active_kcal), UMBRAL_REPORTE.kcal, " kcal"),
  );
  const limpios = sinDescartadas(dias, etiquetas);
  const ejercicio = ejercicioDe(limpios, lunes, domingo);
  const ejercicioAnterior = ejercicioDe(limpios, restarDias(lunes, 7), restarDias(lunes, 1));
  const comparable = ejercicio.diasConDatos >= MINIMO_DIAS_SEMANA && ejercicioAnterior.diasConDatos >= MINIMO_DIAS_SEMANA;
  filas.push(
    {
      grupo: "Ejercicio",
      nombre: "Minutos de ejercicio (OMS)",
      actual: `${mil.format(ejercicio.equivalentes)} de ${META_SEMANAL_MIN}`,
      diasActual: null,
      anterior: ejercicioAnterior.diasConDatos ? mil.format(ejercicioAnterior.equivalentes) : "—",
      cambio: ejercicioAnterior.diasConDatos ? conSigno(ejercicio.equivalentes - ejercicioAnterior.equivalentes, " min") : null,
      veredicto: veredictoSimple(true, ejercicioAnterior.equivalentes, ejercicio.equivalentes, UMBRAL_REPORTE.equivalentes, comparable),
    },
    {
      grupo: "Ejercicio",
      nombre: "Sesiones",
      actual: mil.format(ejercicio.sesiones),
      diasActual: null,
      anterior: ejercicioAnterior.diasConDatos ? mil.format(ejercicioAnterior.sesiones) : "—",
      cambio: ejercicioAnterior.diasConDatos ? conSigno(ejercicio.sesiones - ejercicioAnterior.sesiones) : null,
      veredicto: veredictoSimple(true, ejercicioAnterior.sesiones, ejercicio.sesiones, UMBRAL_REPORTE.sesiones, comparable),
    },
  );
  return {
    lunes,
    domingo,
    noches: semana.noches,
    diasConDatos: ejercicio.diasConDatos,
    filas,
    ejercicio,
    ejercicioAnterior,
  };
}

// ------------------------------------------------------------- texto

const nombreCorto = (f: FilaReporte) => f.nombre.replace(/ \(.*\)$/, "").replace(/ por día$/, "");

/** Frases del reporte: qué mejoró, qué empeoró y el ejercicio vs. la meta. */
export function frasesReporte(r: ReporteSemanal): string[] {
  if (!r.diasConDatos) return ["No llegaron datos del anillo esta semana. Revisa que el colector de la laptop esté leyendo."];
  const mejoro = r.filas.filter((f) => f.veredicto === "mejor").map(nombreCorto);
  const empeoro = r.filas.filter((f) => f.veredicto === "peor").map(nombreCorto);
  const frases: string[] = [];
  if (mejoro.length) frases.push(`Mejoró: ${lista(mejoro)}.`);
  if (empeoro.length) frases.push(`Empeoró: ${lista(empeoro)}.`);
  if (!mejoro.length && !empeoro.length)
    frases.push(
      r.filas.some((f) => f.veredicto === "igual")
        ? "Una semana pareja: nada cambió lo suficiente contra la anterior."
        : "Todavía no hay dos semanas con al menos 3 días de datos para comparar.",
    );
  const e = r.ejercicio;
  const falta = META_SEMANAL_MIN - e.equivalentes;
  frases.push(
    e.sesiones === 0
      ? `No se detectaron sesiones de ejercicio (meta OMS: ${META_SEMANAL_MIN} min).`
      : `Ejercicio: ${e.sesiones} ${e.sesiones === 1 ? "sesión" : "sesiones"}, ${mil.format(e.minutos)} min; ` +
          (falta <= 0 ? `cumpliste los ${META_SEMANAL_MIN} min de la OMS.` : `te faltaron ${mil.format(falta)} min para los ${META_SEMANAL_MIN} de la OMS.`),
  );
  frases.push(`${r.noches} de 7 noches con datos.`);
  return frases;
}

function lista(x: readonly string[]): string {
  return x.length < 2 ? (x[0] ?? "") : `${x.slice(0, -1).join(", ")} y ${x.at(-1)}`;
}
