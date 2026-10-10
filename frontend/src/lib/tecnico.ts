// Indicadores de análisis técnico para la pestaña QQQ / TQQQ. Funciones puras
// sobre las velas diarias (sin React), igual que indicadores.ts/tarjetas.ts.
// Todo se calcula sobre la serie COMPLETA (10 años) y la vista solo recorta
// el rango visible -- así la SMA 200 ya tiene historia desde el primer día
// que se muestra.

import type { SerieCotizaciones, Simbolo, Vela } from "../../functions/api/cotizaciones";
import { CONFIG_DETECCION, type ConfigDeteccion } from "./patrones/config";

export type { SerieCotizaciones, Simbolo, Vela };

export interface PuntoTecnico extends Vela {
  /** Cambio vs. el cierre anterior (fracción, 0.012 = +1.2%). */
  cambio: number | null;
  sma50: number | null;
  sma200: number | null;
  bbMedia: number | null;
  bbSuperior: number | null;
  bbInferior: number | null;
  rsi: number | null;
  macd: number | null;
  senal: number | null;
  histograma: number | null;
  atr: number | null;
  /** Caída desde el máximo de cierre previo (≤ 0). */
  drawdown: number;
  /** Promedio del volumen de las últimas `volumen.ventanaPromedio` sesiones (20). */
  volumenPromedio20: number | null;
  /** Volumen / su promedio (null sin promedio). */
  volumenRelativo: number | null;
  /** Volumen por encima de `volumen.umbralAlto` veces su promedio. */
  volumenAlto: boolean;
  /** Cierre >= cierre previo (en la primera vela, cierre >= apertura): color de la barra de volumen. */
  alzaDelDia: boolean;
}

type Serie = (number | null)[];

export function sma(valores: number[], n: number): Serie {
  const salida: Serie = new Array(valores.length).fill(null);
  let suma = 0;
  valores.forEach((v, i) => {
    suma += v;
    if (i >= n) suma -= valores[i - n];
    if (i >= n - 1) salida[i] = suma / n;
  });
  return salida;
}

/** EMA sembrada con la SMA de los primeros n valores (no nulos). */
export function ema(valores: Serie, n: number): Serie {
  const salida: Serie = new Array(valores.length).fill(null);
  const k = 2 / (n + 1);
  let previo: number | null = null;
  let acumulados: number[] = [];
  valores.forEach((v, i) => {
    if (v == null) return;
    if (previo == null) {
      acumulados.push(v);
      if (acumulados.length === n) {
        previo = acumulados.reduce((a, b) => a + b, 0) / n;
        salida[i] = previo;
        acumulados = [];
      }
      return;
    }
    previo = v * k + previo * (1 - k);
    salida[i] = previo;
  });
  return salida;
}

/** RSI de Wilder. */
export function rsi(cierres: number[], n = 14): Serie {
  const salida: Serie = new Array(cierres.length).fill(null);
  let ganancia = 0;
  let perdida = 0;
  for (let i = 1; i < cierres.length; i++) {
    const delta = cierres[i] - cierres[i - 1];
    const sube = Math.max(delta, 0);
    const baja = Math.max(-delta, 0);
    if (i <= n) {
      ganancia += sube / n;
      perdida += baja / n;
      if (i < n) continue;
    } else {
      ganancia = (ganancia * (n - 1) + sube) / n;
      perdida = (perdida * (n - 1) + baja) / n;
    }
    salida[i] = perdida === 0 ? 100 : 100 - 100 / (1 + ganancia / perdida);
  }
  return salida;
}

/** ATR de Wilder. */
export function atr(velas: Vela[], n = 14): Serie {
  const salida: Serie = new Array(velas.length).fill(null);
  let promedio = 0;
  velas.forEach((v, i) => {
    const rango =
      i === 0
        ? v.maximo - v.minimo
        : Math.max(
            v.maximo - v.minimo,
            Math.abs(v.maximo - velas[i - 1].cierre),
            Math.abs(v.minimo - velas[i - 1].cierre)
          );
    if (i < n) {
      promedio += rango / n;
      if (i === n - 1) salida[i] = promedio;
      return;
    }
    promedio = (promedio * (n - 1) + rango) / n;
    salida[i] = promedio;
  });
  return salida;
}

function desviacion(valores: number[]): number {
  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  return Math.sqrt(valores.reduce((a, v) => a + (v - media) ** 2, 0) / valores.length);
}

export function calcularSerieTecnica(
  velas: Vela[],
  config: ConfigDeteccion = CONFIG_DETECCION
): PuntoTecnico[] {
  const cierres = velas.map((v) => v.cierre);
  const sma50 = sma(cierres, 50);
  const sma200 = sma(cierres, 200);
  const sma20 = sma(cierres, 20);
  const rsi14 = rsi(cierres);
  const ema12 = ema(cierres, 12);
  const ema26 = ema(cierres, 26);
  const macd = ema12.map((v, i) => (v == null || ema26[i] == null ? null : v - ema26[i]!));
  const senal = ema(macd, 9);
  const atr14 = atr(velas, config.atr.periodo);
  const volumen20 = sma(
    velas.map((v) => v.volumen),
    config.volumen.ventanaPromedio
  );
  let maximo = -Infinity;
  return velas.map((v, i) => {
    maximo = Math.max(maximo, v.cierre);
    let bbSuperior: number | null = null;
    let bbInferior: number | null = null;
    if (sma20[i] != null) {
      const sd = desviacion(cierres.slice(i - 19, i + 1));
      bbSuperior = sma20[i]! + 2 * sd;
      bbInferior = sma20[i]! - 2 * sd;
    }
    const volumenRelativo = volumen20[i] && volumen20[i]! > 0 ? v.volumen / volumen20[i]! : null;
    return {
      ...v,
      cambio: i === 0 ? null : v.cierre / velas[i - 1].cierre - 1,
      sma50: sma50[i],
      sma200: sma200[i],
      bbMedia: sma20[i],
      bbSuperior,
      bbInferior,
      rsi: rsi14[i],
      macd: macd[i],
      senal: senal[i],
      histograma: macd[i] == null || senal[i] == null ? null : macd[i]! - senal[i]!,
      atr: atr14[i],
      drawdown: v.cierre / maximo - 1,
      volumenPromedio20: volumen20[i],
      volumenRelativo,
      volumenAlto: volumenRelativo !== null && volumenRelativo > config.volumen.umbralAlto,
      alzaDelDia: i === 0 ? v.cierre >= v.apertura : v.cierre >= velas[i - 1].cierre,
    };
  });
}

// ---------------------------------------------------------------- rangos

export type RangoTecnico = "3M" | "6M" | "1A" | "2A" | "5A" | "10A";
export const RANGOS_TECNICOS: { id: RangoTecnico; meses: number }[] = [
  { id: "3M", meses: 3 },
  { id: "6M", meses: 6 },
  { id: "1A", meses: 12 },
  { id: "2A", meses: 24 },
  { id: "5A", meses: 60 },
  { id: "10A", meses: 120 },
];

/** Fecha (YYYY-MM-DD) desde la que se muestra el rango, contando hacia atrás
 * desde la última vela (no desde hoy: en fin de semana daría lo mismo). */
export function inicioRango(ultimaFecha: string, rango: RangoTecnico): string {
  const meses = RANGOS_TECNICOS.find((r) => r.id === rango)!.meses;
  const fecha = new Date(`${ultimaFecha}T00:00:00Z`);
  fecha.setUTCMonth(fecha.getUTCMonth() - meses);
  return fecha.toISOString().slice(0, 10);
}

export function recortar<T extends { fecha: string }>(puntos: T[], desde: string): T[] {
  return puntos.filter((p) => p.fecha >= desde);
}

// ---------------------------------------------------------------- lectura

export interface Cruce {
  fecha: string;
  /** true = la rápida cruzó hacia arriba (cruce dorado / MACD sobre señal). */
  alcista: boolean;
}

/** Último cruce entre dos series (rápida vs lenta), o null si nunca cruzaron
 * dentro de los datos con ambas definidas. */
export function ultimoCruce(
  puntos: PuntoTecnico[],
  rapida: (p: PuntoTecnico) => number | null,
  lenta: (p: PuntoTecnico) => number | null
): Cruce | null {
  for (let i = puntos.length - 1; i > 0; i--) {
    const [a0, b0, a1, b1] = [rapida(puntos[i - 1]), lenta(puntos[i - 1]), rapida(puntos[i]), lenta(puntos[i])];
    if (a0 == null || b0 == null || a1 == null || b1 == null) return null;
    if (a0 <= b0 && a1 > b1) return { fecha: puntos[i].fecha, alcista: true };
    if (a0 >= b0 && a1 < b1) return { fecha: puntos[i].fecha, alcista: false };
  }
  return null;
}

/** Sesiones seguidas (contando la última) con el cierre del mismo lado de la
 * SMA 200 que hoy. */
export function sesionesDelLadoSma200(puntos: PuntoTecnico[]): number {
  const ultimo = puntos[puntos.length - 1];
  if (ultimo?.sma200 == null) return 0;
  const arriba = ultimo.cierre > ultimo.sma200;
  let n = 0;
  for (let i = puntos.length - 1; i >= 0; i--) {
    const p = puntos[i];
    if (p.sma200 == null || p.cierre > p.sma200 !== arriba) break;
    n++;
  }
  return n;
}

/** Volatilidad anualizada de los últimos n rendimientos logarítmicos diarios. */
export function volatilidadAnualizada(cierres: number[], n = 20): number | null {
  if (cierres.length < n + 1) return null;
  const tramo = cierres.slice(-(n + 1));
  const rendimientos = tramo.slice(1).map((c, i) => Math.log(c / tramo[i]));
  return desviacion(rendimientos) * Math.sqrt(252);
}

/** Máximo y mínimo de cierre de las últimas 252 sesiones (~52 semanas). */
export function extremos52Semanas(puntos: PuntoTecnico[]): { maximo: number; minimo: number } {
  const tramo = puntos.slice(-252).map((p) => p.cierre);
  return { maximo: Math.max(...tramo), minimo: Math.min(...tramo) };
}

// ------------------------------------------------- soportes y resistencias

// La lógica vive en patrones/niveles.ts (junto al motor de pivotes y a los
// detectores de patrones); se reexporta aquí por compatibilidad.
export { calcularNiveles, type NivelTecnico } from "./patrones/niveles";

/** Sesiones que se miran para los niveles (~6 meses): ver `CONFIG_DETECCION.niveles`. */
export const SESIONES_NIVELES = CONFIG_DETECCION.niveles.sesiones;

// ---------------------------------------------------------- comparativo

export interface PuntoComparativo {
  fecha: string;
  /** Base 100 al inicio del rango. */
  qqq: number;
  tqqq: number;
  ddQqq: number;
  ddTqqq: number;
}

export interface ResumenComparativo {
  rendimientoQqq: number;
  rendimientoTqqq: number;
  /** 3 × el rendimiento de QQQ en el mismo rango: lo que un lector ingenuo
   * esperaría de un ETF 3x. La diferencia con el real es el efecto de la
   * capitalización diaria (en mercados laterales/volátiles, "decay"). */
  tresVecesQqq: number;
  beta: number | null;
  volatilidadQqq: number | null;
  volatilidadTqqq: number | null;
  maxDrawdownQqq: number;
  maxDrawdownTqqq: number;
}

/** Une QQQ y TQQQ por fecha (solo días con ambos) desde `desde`. */
export function compararQqqTqqq(
  qqq: Vela[],
  tqqq: Vela[],
  desde: string
): { puntos: PuntoComparativo[]; resumen: ResumenComparativo } | null {
  const porFecha = new Map(tqqq.map((v) => [v.fecha, v.cierre]));
  const pares = qqq
    .filter((v) => v.fecha >= desde && porFecha.has(v.fecha))
    .map((v) => ({ fecha: v.fecha, q: v.cierre, t: porFecha.get(v.fecha)! }));
  if (pares.length < 2) return null;
  const [base] = pares;
  let maxQ = -Infinity;
  let maxT = -Infinity;
  const puntos = pares.map(({ fecha, q, t }) => {
    maxQ = Math.max(maxQ, q);
    maxT = Math.max(maxT, t);
    return {
      fecha,
      qqq: (q / base.q) * 100,
      tqqq: (t / base.t) * 100,
      ddQqq: q / maxQ - 1,
      ddTqqq: t / maxT - 1,
    };
  });
  const rq = pares.slice(1).map((p, i) => p.q / pares[i].q - 1);
  const rt = pares.slice(1).map((p, i) => p.t / pares[i].t - 1);
  const mediaQ = rq.reduce((a, b) => a + b, 0) / rq.length;
  const mediaT = rt.reduce((a, b) => a + b, 0) / rt.length;
  const covarianza = rq.reduce((a, r, i) => a + (r - mediaQ) * (rt[i] - mediaT), 0) / rq.length;
  const varianza = rq.reduce((a, r) => a + (r - mediaQ) ** 2, 0) / rq.length;
  const ultimo = pares[pares.length - 1];
  return {
    puntos,
    resumen: {
      rendimientoQqq: ultimo.q / base.q - 1,
      rendimientoTqqq: ultimo.t / base.t - 1,
      tresVecesQqq: 3 * (ultimo.q / base.q - 1),
      beta: varianza === 0 ? null : covarianza / varianza,
      volatilidadQqq: rq.length >= 2 ? desviacion(rq) * Math.sqrt(252) : null,
      volatilidadTqqq: rt.length >= 2 ? desviacion(rt) * Math.sqrt(252) : null,
      maxDrawdownQqq: Math.min(...puntos.map((p) => p.ddQqq)),
      maxDrawdownTqqq: Math.min(...puntos.map((p) => p.ddTqqq)),
    },
  };
}

// ---------------------------------------------------------------- datos

const cache = new Map<Simbolo, { cuando: number; serie: SerieCotizaciones }>();
const VIGENCIA_MS = 5 * 60 * 1000;

/** Trae las velas de /api/cotizaciones (Pages Function). Cache en memoria de
 * 5 min para que ir y volver de la pestaña no repita la descarga. */
export async function obtenerCotizaciones(
  simbolo: Simbolo,
  forzar = false
): Promise<SerieCotizaciones> {
  const guardada = cache.get(simbolo);
  if (!forzar && guardada && Date.now() - guardada.cuando < VIGENCIA_MS) return guardada.serie;
  const respuesta = await fetch(`/api/cotizaciones?simbolo=${simbolo}`);
  const cuerpo = (await respuesta.json().catch(() => null)) as
    | (SerieCotizaciones & { error?: string })
    | null;
  if (!respuesta.ok || !cuerpo || cuerpo.error) {
    throw new Error(cuerpo?.error ?? `Error ${respuesta.status} al traer ${simbolo}`);
  }
  cache.set(simbolo, { cuando: Date.now(), serie: cuerpo });
  return cuerpo;
}

/** "2026-08-14" → "14 ago 2026" (sin día: "ago 2026"), para títulos y etiquetas. */
export function nombreFecha(fecha: string, conDia = true): string {
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: conDia ? "numeric" : undefined,
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Zona del RSI 14 en palabras, para la lectura técnica. */
export function zonaRsi(valor: number): string {
  if (valor >= 70) return "Sobrecompra (≥ 70)";
  if (valor <= 30) return "Sobreventa (≤ 30)";
  return "Zona neutral";
}
