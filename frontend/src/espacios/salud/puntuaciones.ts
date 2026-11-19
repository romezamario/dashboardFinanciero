// Puntuaciones propias de 0 a 100 (Mario, 2026-11-19: idea 3, "puntuaciones
// propias de sueño, recuperación y actividad"). Se calculan en el navegador con
// lo que el colector ya sube por día (noche, actividad, ejercicio) y con TUS
// líneas base; no son las de Oura (sin membresía ni API). La recuperación vive
// en indicadores.ts (`recuperacion`) y usa la de sueño de aquí. Fórmulas
// explicadas en el panel (PuntuacionesSalud.tsx) con FORMULA_*.
import { minutosDormido, num, restarDias, type DiaSalud, type Noche } from "./salud";
import { META_SEMANAL_MIN } from "./ejercicio";

export type NivelPuntuacion = "bien" | "regular" | "bajo";

export interface Componente {
  clave: string;
  nombre: string;
  /** 0 a 100. */
  puntos: number;
  /** Frase corta con el dato: "7 h 10 min de 8 h". */
  texto: string;
  peso: number;
}

export interface Puntuacion {
  fecha: string;
  puntaje: number;
  nivel: NivelPuntuacion;
  componentes: Componente[];
}

/** ≥ 70 bien, 50–69 regular, < 50 bajo (los mismos cortes que el semáforo de recuperación). */
export const nivelDe = (p: number): NivelPuntuacion => (p >= 70 ? "bien" : p >= 50 ? "regular" : "bajo");

const acotar = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
const hm = (min: number) => {
  const m = Math.round(min);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

/** Promedio ponderado de los componentes que sí tienen dato (los que faltan no
 * cuentan ni a favor ni en contra: se reparten los pesos). */
function combinar(fecha: string, componentes: Componente[]): Puntuacion | null {
  const pesoTotal = componentes.reduce((a, c) => a + c.peso, 0);
  if (!componentes.length || pesoTotal <= 0) return null;
  const puntaje = Math.round(componentes.reduce((a, c) => a + c.puntos * c.peso, 0) / pesoTotal);
  return { fecha, puntaje, nivel: nivelDe(puntaje), componentes };
}

// ------------------------------------------------------------------ sueño

/** Lo que necesitas dormir (meta del dashboard). */
export const META_SUENO_MIN = 480;
/** Metas de fases (minutos): ~1.5 h de profundo y ~1 h 40 min de REM en 8 h. */
export const META_PROFUNDO_MIN = 90;
export const META_REM_MIN = 100;
/** Noches previas para tu hora habitual de dormir. */
const NOCHES_HORARIO = 14;
const MINIMO_NOCHES_HORARIO = 3;

/** Hora de dormir en minutos desde las 18:00 (como horarioSueno). */
export function minutosDesde18(hhmm?: string | null): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return (((h - 18 + 24) % 24) * 60 + m) % 1440;
}

const mediana = (v: readonly number[]) => {
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

function minutosFase(n: Noche, pct: number | null | undefined): number | null {
  const cama = num(n.in_bed_h);
  const p = num(pct);
  return cama === null || p === null ? null : Math.round((cama * 60 * p) / 100);
}

export const FORMULA_SUENO: readonly { nombre: string; peso: number; regla: string }[] = [
  { nombre: "Duración", peso: 30, regla: "8 h = 100; cada hora que falta resta 20 (7 h = 80, 6 h = 60)." },
  { nombre: "Eficiencia", peso: 15, regla: "Tiempo dormido / tiempo en cama: 90 % o más = 100, cada punto menos resta 4 (80 % = 60)." },
  { nombre: "Profundo", peso: 12.5, regla: "1 h 30 min o más = 100; menos, proporcional." },
  { nombre: "REM", peso: 12.5, regla: "1 h 40 min o más = 100; menos, proporcional." },
  { nombre: "Latencia", peso: 7.5, regla: "Tardar 5–20 min en dormirte = 100; menos de 5 = 80 (señal de cansancio); arriba de 20 resta 2.5 por minuto." },
  { nombre: "Interrupciones", peso: 7.5, regla: "Despierto ya dormido ≤ 20 min = 100; cada minuto extra resta 1.25." },
  { nombre: "Horario", peso: 15, regla: "Hora de dormir vs. TU mediana de las 14 noches anteriores: ±30 min = 100, ±2 h 30 min = 0." },
];

/** Puntuación de sueño de la noche que terminó `fecha` (por defecto la última).
 * Necesita al menos la duración. */
export function puntuacionSueno(dias: readonly DiaSalud[], fecha?: string): Puntuacion | null {
  const conNoche = dias.filter((d) => d.noche);
  const hoy = fecha ? conNoche.find((d) => d.fecha === fecha) : conNoche.at(-1);
  const n = hoy?.noche;
  const dormido = minutosDormido(n);
  if (!hoy || !n || dormido === null) return null;
  const c: Componente[] = [];
  const peso = (nombre: string) => FORMULA_SUENO.find((f) => f.nombre === nombre)!.peso;

  c.push({
    clave: "duracion",
    nombre: "Duración",
    peso: peso("Duración"),
    puntos: acotar(100 - (Math.max(0, META_SUENO_MIN - dormido) / 60) * 20),
    texto: `${hm(dormido)} de 8 h`,
  });
  const ef = num(n.efficiency);
  if (ef !== null) c.push({ clave: "eficiencia", nombre: "Eficiencia", peso: peso("Eficiencia"), puntos: acotar(100 - Math.max(0, 90 - ef) * 4), texto: `${Math.round(ef)} %` });
  const profundo = minutosFase(n, n.deep_pct);
  if (profundo !== null)
    c.push({ clave: "profundo", nombre: "Profundo", peso: peso("Profundo"), puntos: acotar((profundo / META_PROFUNDO_MIN) * 100), texto: hm(profundo) });
  const rem = minutosFase(n, n.rem_pct);
  if (rem !== null) c.push({ clave: "rem", nombre: "REM", peso: peso("REM"), puntos: acotar((rem / META_REM_MIN) * 100), texto: hm(rem) });
  const lat = num(n.metrics?.sol_min);
  if (lat !== null)
    c.push({
      clave: "latencia",
      nombre: "Latencia",
      peso: peso("Latencia"),
      puntos: lat < 5 ? 80 : acotar(100 - Math.max(0, lat - 20) * 2.5),
      texto: `${Math.round(lat)} min para dormirte`,
    });
  const waso = num(n.metrics?.waso_min);
  if (waso !== null)
    c.push({
      clave: "interrupciones",
      nombre: "Interrupciones",
      peso: peso("Interrupciones"),
      puntos: acotar(100 - Math.max(0, waso - 20) * 1.25),
      texto: `${Math.round(waso)} min despierto${num(n.metrics?.awakenings) !== null ? ` · ${n.metrics!.awakenings} despertares` : ""}`,
    });
  const dormir = minutosDesde18(n.start);
  const previas = conNoche
    .filter((d) => d.fecha < hoy.fecha && d.fecha >= restarDias(hoy.fecha, NOCHES_HORARIO))
    .map((d) => minutosDesde18(d.noche?.start))
    .filter((v): v is number => v !== null);
  if (dormir !== null && previas.length >= MINIMO_NOCHES_HORARIO) {
    const dif = dormir - mediana(previas);
    const abs = Math.abs(dif);
    c.push({
      clave: "horario",
      nombre: "Horario",
      peso: peso("Horario"),
      puntos: acotar(100 - (Math.max(0, abs - 30) * 100) / 120),
      texto: abs < 15 ? "a tu hora de siempre" : `${hm(abs).replace(/^0 h /, "")} más ${dif > 0 ? "tarde" : "temprano"} que tu hora habitual`,
    });
  }
  return combinar(hoy.fecha, c);
}

// ------------------------------------------------------------- actividad

/** Pasos al día que valen 100 en "Pasos". */
export const META_PASOS = 8000;
/** Días anteriores para tu normal de calorías activas. */
const DIAS_NORMAL_KCAL = 30;
const MINIMO_DIAS_KCAL = 5;

export const FORMULA_ACTIVIDAD: readonly { nombre: string; peso: number; regla: string }[] = [
  { nombre: "Pasos", peso: 30, regla: "8,000 pasos o más = 100; menos, proporcional." },
  { nombre: "Calorías activas", peso: 20, regla: "Vs. TU mediana de los 30 días anteriores: igual = 80, 20 % arriba = 100, la mitad = 30." },
  { nombre: "Frecuencia", peso: 25, regla: "Días con ejercicio en los últimos 7: 3 o más = 100, 2 = 75, 1 = 45, ninguno = 10." },
  { nombre: "Volumen", peso: 25, regla: "Minutos de ejercicio en 7 días (un vigoroso vale 2) vs. los 150 de la OMS: proporcional." },
];

const pesoActividad = (nombre: string) => FORMULA_ACTIVIDAD.find((f) => f.nombre === nombre)!.peso;
const PUNTOS_FRECUENCIA = [10, 45, 75, 100];

/** Puntuación de actividad del día `fecha` (por defecto el último con
 * actividad). El día en curso va subiendo conforme te mueves. */
export function puntuacionActividad(dias: readonly DiaSalud[], fecha?: string): Puntuacion | null {
  const conActividad = dias.filter((d) => d.actividad || d.ejercicio?.length);
  const hoy = fecha ? dias.find((d) => d.fecha === fecha) : conActividad.at(-1);
  if (!hoy || !(hoy.actividad || hoy.ejercicio?.length)) return null;
  const c: Componente[] = [];

  const pasos = num(hoy.actividad?.steps);
  if (pasos !== null)
    c.push({
      clave: "pasos",
      nombre: "Pasos",
      peso: pesoActividad("Pasos"),
      puntos: acotar((pasos / META_PASOS) * 100),
      texto: `${pasos.toLocaleString("es-MX")} de ${META_PASOS.toLocaleString("es-MX")}`,
    });
  const kcal = num(hoy.actividad?.active_kcal);
  const previas = dias
    .filter((d) => d.fecha < hoy.fecha && d.fecha >= restarDias(hoy.fecha, DIAS_NORMAL_KCAL))
    .map((d) => num(d.actividad?.active_kcal))
    .filter((v): v is number => v !== null && v > 0);
  if (kcal !== null && previas.length >= MINIMO_DIAS_KCAL) {
    const normal = mediana(previas);
    const razon = kcal / normal;
    c.push({
      clave: "kcal",
      nombre: "Calorías activas",
      peso: pesoActividad("Calorías activas"),
      puntos: acotar(80 + 100 * (razon - 1)),
      texto: `${Math.round(kcal)} kcal (tu normal ${Math.round(normal)})`,
    });
  }
  // Ejercicio de los 7 días que terminan en `fecha`. Si el colector aún no
  // sube sesiones (antes de v4), no se juzga.
  const semana = dias.filter((d) => d.fecha > restarDias(hoy.fecha, 7) && d.fecha <= hoy.fecha);
  if (dias.some((d) => Array.isArray(d.ejercicio))) {
    const diasCon = semana.filter((d) => d.ejercicio?.length).length;
    c.push({
      clave: "frecuencia",
      nombre: "Frecuencia",
      peso: pesoActividad("Frecuencia"),
      puntos: PUNTOS_FRECUENCIA[Math.min(3, diasCon)],
      texto: `${diasCon} de 7 días con ejercicio`,
    });
    const equivalentes = semana.flatMap((d) => d.ejercicio ?? []).reduce((t, s) => t + s.min_moderados + 2 * s.min_vigorosos, 0);
    c.push({
      clave: "volumen",
      nombre: "Volumen",
      peso: pesoActividad("Volumen"),
      puntos: acotar((equivalentes / META_SEMANAL_MIN) * 100),
      texto: `${Math.round(equivalentes)} de ${META_SEMANAL_MIN} min en 7 días`,
    });
  }
  return combinar(hoy.fecha, c);
}

// ------------------------------------------------------------- historial

export interface PuntoPuntuaciones {
  fecha: string;
  sueno: number | null;
  recuperacion: number | null;
  actividad: number | null;
}

/** Las tres puntuaciones de cada día de `fechas`. La recuperación la pasa quien
 * llama (vive en indicadores.ts, que importa este módulo). */
export function historialPuntuaciones(
  dias: readonly DiaSalud[],
  fechas: readonly string[],
  recuperacionDe: (fecha: string) => number | null,
): PuntoPuntuaciones[] {
  return fechas.map((fecha) => ({
    fecha,
    sueno: puntuacionSueno(dias, fecha)?.puntaje ?? null,
    recuperacion: recuperacionDe(fecha),
    actividad: puntuacionActividad(dias, fecha)?.puntaje ?? null,
  }));
}
