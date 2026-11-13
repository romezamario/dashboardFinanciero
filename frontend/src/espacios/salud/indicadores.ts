// Indicadores nuevos del espacio Salud (Mario, 2026-11-13: "todos" los puntos
// de la propuesta). Funciones puras sobre DiaSalud; dibujo en
// IndicadoresSalud.tsx, pruebas en indicadores.test.ts.
import {
  desviacionEstandar,
  horarioSueno,
  minutosDormido,
  num,
  promedio,
  restarDias,
  type DiaSalud,
  type PeriodoSueno,
} from "./salud";

// ------------------------------------------------ noches sin datos

export type EstadoNoche = "con-datos" | "sin-bateria" | "sin-datos";

/** Un día sin noche durante el cual el anillo estuvo apagado ≥ 2 h es "sin
 * batería" (así se explica el hueco); cualquier otro día sin noche, "sin datos". */
export function estadoNoche(dia: DiaSalud | undefined): EstadoNoche {
  if (dia?.noche) return "con-datos";
  return (dia?.apagones ?? []).some((a) => num(a.horas) !== null && a.horas >= 2) ? "sin-bateria" : "sin-datos";
}

// ------------------------------------------------ siestas y bloques

/** Los periodos de sueño que terminaron ese día, en orden. Las filas que el
 * colector subió antes de 2026-11-13 no traen `periodos`: se usa la noche. */
export function periodosDelDia(dia: DiaSalud | undefined): PeriodoSueno[] {
  if (dia?.periodos?.length) return [...dia.periodos].sort((a, b) => (a.inicio ?? 0) - (b.inicio ?? 0));
  const n = dia?.noche;
  if (!n) return [];
  return [
    {
      inicio: n.start_unix,
      fin: n.end_unix,
      start: n.start,
      end: n.end,
      en_cama_h: n.in_bed_h,
      dormido_min: minutosDormido(n),
      eficiencia: n.efficiency,
      principal: true,
    },
  ];
}

/** Minutos de un periodo: los dormidos si se midieron, si no los de cama. */
export function minutosPeriodo(p: PeriodoSueno): number | null {
  const dormido = num(p.dormido_min);
  if (dormido !== null) return dormido;
  const cama = num(p.en_cama_h);
  return cama === null ? null : Math.round(cama * 60);
}

/** Cuántos periodos además del principal (siestas o bloques sueltos). */
export function siestasDelDia(dia: DiaSalud | undefined): number {
  return periodosDelDia(dia).filter((p) => !p.principal).length;
}

// ------------------------------------------- semáforo de recuperación

export type NivelRecuperacion = "listo" | "moderado" | "descansa";
export type ClaveFactor = "hrv" | "rhr" | "sueno" | "temp" | "resp";

export interface Factor {
  clave: ClaveFactor;
  nombre: string;
  /** 0 a 100 (100 = mejor que tu normal o igual). */
  puntos: number;
  /** Frase corta: "+6 ms sobre tu normal". */
  texto: string;
  peso: number;
}

export interface Recuperacion {
  fecha: string;
  puntaje: number;
  nivel: NivelRecuperacion;
  factores: Factor[];
  /** Noches de base que tuvo la comparación (la más corta entre factores). */
  nochesBase: number;
}

/** Noches previas mínimas para comparar contra "tu normal". */
export const MINIMO_NOCHES_BASE = 3;
/** Ventana de la línea base (días antes de la noche). */
const DIAS_BASE = 30;

interface DefFactor {
  clave: ClaveFactor;
  nombre: string;
  peso: number;
  leer: (d: DiaSalud) => number | null;
  /** Desviación mínima (unidades del dato): con pocas noches la desviación sale
   * casi 0 y cualquier cambio parecería enorme. */
  sdMinima: number;
  /** z orientado: positivo = bueno. */
  orientar: (z: number) => number;
  texto: (diferencia: number) => string;
}

const conSigno = (v: number, dec = 0) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dec)}`;

const FACTORES: readonly DefFactor[] = [
  {
    clave: "hrv",
    nombre: "HRV",
    peso: 0.3,
    leer: (d) => num(d.noche?.hrv_ms),
    sdMinima: 3,
    orientar: (z) => z,
    texto: (x) => `${conSigno(x)} ms vs. tu normal`,
  },
  {
    clave: "rhr",
    nombre: "FC en reposo",
    peso: 0.2,
    leer: (d) => num(d.noche?.rhr),
    sdMinima: 1.5,
    orientar: (z) => -z,
    texto: (x) => `${conSigno(x)} lpm vs. tu normal`,
  },
  {
    clave: "temp",
    nombre: "Temperatura",
    peso: 0.15,
    leer: (d) => num(d.noche?.skin_temp),
    sdMinima: 0.15,
    // Cualquier desviación (arriba o abajo) cuenta en contra.
    orientar: (z) => -Math.abs(z),
    texto: (x) => `${conSigno(x, 1)} °C vs. tu normal`,
  },
  {
    clave: "resp",
    nombre: "Respiración",
    peso: 0.1,
    leer: (d) => num(d.noche?.breath_rate),
    sdMinima: 0.5,
    // Respirar más rápido de noche es la señal temprana; más lento no resta.
    orientar: (z) => -Math.max(0, z),
    texto: (x) => `${conSigno(x, 1)} resp/min vs. tu normal`,
  },
];

/** z orientado → puntos: 0 (tu normal) = 75, +1 = 100, −1 = 50, −3 = 0. */
const puntosDeZ = (z: number) => Math.round(Math.min(100, Math.max(0, 75 + 25 * z)));

/** Semáforo de recuperación de la noche más reciente (o de `fecha`): cada señal
 * contra TU promedio de los 30 días anteriores (≥ 3 noches), más cuánto
 * dormiste contra 8 h. Es un cálculo propio, no el "Readiness" de Oura. */
export function recuperacion(dias: readonly DiaSalud[], fecha?: string): Recuperacion | null {
  const conNoche = dias.filter((d) => d.noche);
  const hoy = fecha ? conNoche.find((d) => d.fecha === fecha) : conNoche.at(-1);
  if (!hoy) return null;
  const previos = conNoche.filter((d) => d.fecha < hoy.fecha && d.fecha >= restarDias(hoy.fecha, DIAS_BASE));
  const factores: Factor[] = [];
  let nochesBase = Infinity;
  for (const f of FACTORES) {
    const valor = f.leer(hoy);
    const base = previos.map(f.leer).filter((v): v is number => v !== null);
    if (valor === null || base.length < MINIMO_NOCHES_BASE) continue;
    const media = promedio(base) as number;
    const sd = Math.max(desviacionEstandar(base) ?? 0, f.sdMinima);
    factores.push({ clave: f.clave, nombre: f.nombre, peso: f.peso, puntos: puntosDeZ(f.orientar((valor - media) / sd)), texto: f.texto(valor - media) });
    nochesBase = Math.min(nochesBase, base.length);
  }
  const dormido = minutosDormido(hoy.noche);
  if (dormido !== null) {
    factores.push({
      clave: "sueno",
      nombre: "Sueño",
      peso: 0.25,
      // 8 h = 100; 6 h = 75; 4 h = 50.
      puntos: Math.round(Math.min(100, Math.max(0, (dormido / 480) * 100))),
      texto: `${Math.floor(dormido / 60)} h ${String(Math.round(dormido % 60)).padStart(2, "0")} min de 8 h`,
    });
  }
  // Sin ninguna señal comparada contra tu normal no hay semáforo (solo sueño
  // sería un dato, no una recuperación).
  if (!factores.some((f) => f.clave !== "sueno")) return null;
  const pesoTotal = factores.reduce((a, f) => a + f.peso, 0);
  const puntaje = Math.round(factores.reduce((a, f) => a + f.puntos * f.peso, 0) / pesoTotal);
  return {
    fecha: hoy.fecha,
    puntaje,
    nivel: puntaje >= 70 ? "listo" : puntaje >= 50 ? "moderado" : "descansa",
    factores,
    nochesBase: Number.isFinite(nochesBase) ? nochesBase : 0,
  };
}

/** Puntaje de sueño de oura.exe (0–100) de la noche, si lo calculó. */
export function puntajeSueno(dia: DiaSalud | undefined): number | null {
  return num(dia?.noche?.sleep_score?.score);
}

// ------------------------------------------- constancia del horario

export type NivelConstancia = "muy-constante" | "regular" | "irregular";

export interface Constancia {
  /** Desviación estándar en minutos. */
  dormir: number;
  despertar: number;
  /** Hora promedio (minutos desde las 18:00, como horarioSueno). */
  dormirPromedio: number;
  despertarPromedio: number;
  nivel: NivelConstancia;
  noches: number;
}

/** Qué tanto varían tu hora de dormir y de despertar (≥ 3 noches). Nivel por
 * la peor de las dos: ≤ 30 min muy constante, ≤ 60 regular, más irregular. */
export function constanciaHorario(dias: readonly DiaSalud[]): Constancia | null {
  const rangos = horarioSueno(dias);
  if (rangos.length < 3) return null;
  const dormir = rangos.map((r) => r.rango[0]);
  const despertar = rangos.map((r) => r.rango[1]);
  const sdDormir = desviacionEstandar(dormir) ?? 0;
  const sdDespertar = desviacionEstandar(despertar) ?? 0;
  const peor = Math.max(sdDormir, sdDespertar);
  return {
    dormir: Math.round(sdDormir),
    despertar: Math.round(sdDespertar),
    dormirPromedio: Math.round(promedio(dormir) as number),
    despertarPromedio: Math.round(promedio(despertar) as number),
    nivel: peor <= 30 ? "muy-constante" : peor <= 60 ? "regular" : "irregular",
    noches: rangos.length,
  };
}

// ------------------------------------------- temperatura del día

export interface PuntoTempDia {
  hora: number;
  valor: number | null;
  /** Promedio de esa hora en tus otros días (tu curva normal). */
  normal: number | null;
}

/** Días con temperatura por hora, del más reciente al más antiguo. */
export function diasConTemperatura(dias: readonly DiaSalud[]): string[] {
  return dias
    .filter((d) => d.tempHoras?.length)
    .map((d) => d.fecha)
    .reverse();
}

/** Curva de 24 h del día `fecha` contra el promedio por hora de los demás días. */
export function temperaturaDelDia(dias: readonly DiaSalud[], fecha: string): PuntoTempDia[] {
  const porHora = new Map<number, number[]>();
  let delDia = new Map<number, number>();
  for (const d of dias) {
    for (const h of d.tempHoras ?? []) {
      if (num(h.mediana) === null || num(h.hora) === null) continue;
      if (d.fecha === fecha) continue;
      porHora.set(h.hora, [...(porHora.get(h.hora) ?? []), h.mediana]);
    }
    if (d.fecha === fecha) delDia = new Map((d.tempHoras ?? []).map((h) => [h.hora, h.mediana]));
  }
  return Array.from({ length: 24 }, (_, hora) => {
    const otros = porHora.get(hora);
    const normal = otros?.length ? promedio(otros) : null;
    return {
      hora,
      valor: delDia.get(hora) ?? null,
      normal: normal === null ? null : Math.round(normal * 100) / 100,
    };
  });
}

/** La hora más caliente del día que se aleja ≥ 0.8 °C de tu normal para esa
 * hora (posible fiebre o un día de calor); null si no hay. */
export function horaFueraDeLoNormal(puntos: readonly PuntoTempDia[]): PuntoTempDia | null {
  const fuera = puntos.filter((p) => p.valor !== null && p.normal !== null && p.valor - p.normal >= 0.8);
  return fuera.length ? fuera.reduce((a, b) => ((b.valor as number) - (b.normal as number) > (a.valor as number) - (a.normal as number) ? b : a)) : null;
}
