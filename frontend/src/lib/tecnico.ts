// Indicadores de análisis técnico para la pestaña QQQ / TQQQ. Funciones puras
// sobre las velas diarias (sin React), igual que indicadores.ts/tarjetas.ts.
// Todo se calcula sobre la serie COMPLETA (10 años) y la vista solo recorta
// el rango visible -- así la SMA 200 ya tiene historia desde el primer día
// que se muestra.

import type { SerieCotizaciones, Simbolo, Vela } from "../../functions/api/cotizaciones";

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
  volumenPromedio20: number | null;
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

export function calcularSerieTecnica(velas: Vela[]): PuntoTecnico[] {
  const cierres = velas.map((v) => v.cierre);
  const sma50 = sma(cierres, 50);
  const sma200 = sma(cierres, 200);
  const sma20 = sma(cierres, 20);
  const rsi14 = rsi(cierres);
  const ema12 = ema(cierres, 12);
  const ema26 = ema(cierres, 26);
  const macd = ema12.map((v, i) => (v == null || ema26[i] == null ? null : v - ema26[i]!));
  const senal = ema(macd, 9);
  const atr14 = atr(velas);
  const volumen20 = sma(
    velas.map((v) => v.volumen),
    20
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

export interface NivelTecnico {
  tipo: "soporte" | "resistencia";
  /** "Soporte inmediato", "Soporte mayor · SMA 50"... */
  nombre: string;
  /** Rango aproximado de la zona (desde ≤ hasta). */
  desde: number;
  hasta: number;
  /** Punto medio: donde se dibuja la línea. */
  valor: number;
  origen: "pivotes" | "sma50" | "sma200" | "maximo";
  /** Veces que el precio giró en la zona (solo origen "pivotes"). */
  toques: number;
}

/** Sesiones que se miran para los niveles (~6 meses): fijo, no depende del
 * rango de la gráfica, para que los niveles no cambien al hacer zoom. */
export const SESIONES_NIVELES = 126;
/** Un pivote es el máximo (o mínimo) de las K sesiones a cada lado. */
const K_PIVOTE = 5;
/** Pivotes a menos de esta fracción del ATR se juntan en una zona. */
const AGRUPAR_ATR = 0.75;
/** Una media a menos de esta fracción del ATR de una zona la absorbe. */
const FUSIONAR_SMA_ATR = 0.5;
/** Medio ancho mínimo de una zona, como fracción del precio (±0.25%). */
const MEDIO_ANCHO_MINIMO = 0.0025;

interface Zona {
  desde: number;
  hasta: number;
  valor: number;
  toques: number;
}

/** Máximos y mínimos locales ("pivotes"): giros del precio. */
function pivotes(puntos: PuntoTecnico[]): number[] {
  const precios: number[] = [];
  for (let i = K_PIVOTE; i < puntos.length - K_PIVOTE; i++) {
    const vecinos = puntos.slice(i - K_PIVOTE, i + K_PIVOTE + 1);
    if (puntos[i].maximo === Math.max(...vecinos.map((p) => p.maximo))) precios.push(puntos[i].maximo);
    if (puntos[i].minimo === Math.min(...vecinos.map((p) => p.minimo))) precios.push(puntos[i].minimo);
  }
  return precios;
}

function ensanchar(desde: number, hasta: number): { desde: number; hasta: number } {
  const centro = (desde + hasta) / 2;
  const medio = Math.max((hasta - desde) / 2, centro * MEDIO_ANCHO_MINIMO);
  return { desde: centro - medio, hasta: centro + medio };
}

/** Junta pivotes cercanos (a menos de `tolerancia`) en zonas. */
function agruparEnZonas(precios: number[], tolerancia: number): Zona[] {
  const ordenados = [...precios].sort((a, b) => a - b);
  const grupos: number[][] = [];
  for (const p of ordenados) {
    const actual = grupos[grupos.length - 1];
    if (actual && p - actual[actual.length - 1] <= tolerancia) actual.push(p);
    else grupos.push([p]);
  }
  return grupos.map((g) => {
    const { desde, hasta } = ensanchar(g[0], g[g.length - 1]);
    return { desde, hasta, valor: (desde + hasta) / 2, toques: g.length };
  });
}

/**
 * Soportes y resistencias de los últimos ~6 meses, para dibujar sobre la
 * gráfica de precio. Mecánico y aproximado (como lo trazaría alguien a mano):
 * - zonas = pivotes (giros) agrupados si están a menos de 0.75 ATR;
 * - resistencia = la zona más cercana por encima del cierre (o el máximo de
 *   6 meses si el precio está en máximos);
 * - soportes por debajo: inmediato y intermedio = las dos más cercanas,
 *   estructural = la de más toques entre las demás;
 * - SMA 50 y SMA 200 como soporte (o resistencia) dinámico; si una zona de
 *   pivotes coincide con la media, se fusiona en ella.
 * Ordenados de arriba a abajo.
 */
export function calcularNiveles(puntos: PuntoTecnico[]): NivelTecnico[] {
  const ventana = puntos.slice(-SESIONES_NIVELES);
  const ultimo = ventana[ventana.length - 1];
  if (!ultimo || ventana.length < K_PIVOTE * 4) return [];
  const precio = ultimo.cierre;
  const atrActual = ultimo.atr ?? precio * 0.01;
  let zonas = agruparEnZonas(pivotes(ventana), atrActual * AGRUPAR_ATR);
  const niveles: NivelTecnico[] = [];

  // Medias móviles: absorben la zona de pivotes que les quede pegada.
  const medias: { origen: "sma50" | "sma200"; valor: number | null }[] = [
    { origen: "sma50", valor: ultimo.sma50 },
    { origen: "sma200", valor: ultimo.sma200 },
  ];
  for (const { origen, valor } of medias) {
    if (valor == null) continue;
    let { desde, hasta } = ensanchar(valor, valor);
    const cercanas = zonas.filter(
      (z) => Math.abs(z.valor - valor) <= atrActual * FUSIONAR_SMA_ATR + (z.hasta - z.desde) / 2
    );
    for (const z of cercanas) {
      desde = Math.min(desde, z.desde);
      hasta = Math.max(hasta, z.hasta);
    }
    zonas = zonas.filter((z) => !cercanas.includes(z));
    const soporte = valor < precio;
    const etiqueta = origen === "sma50" ? "SMA 50" : "SMA 200";
    niveles.push({
      tipo: soporte ? "soporte" : "resistencia",
      nombre: `${soporte ? (origen === "sma50" ? "Soporte mayor" : "Soporte largo plazo") : "Resistencia"} · ${etiqueta}`,
      desde,
      hasta,
      valor,
      origen,
      toques: cercanas.reduce((n, z) => n + z.toques, 0),
    });
  }

  // Resistencia: la zona más cercana por encima; si no hay (precio en
  // máximos), el máximo de la ventana.
  const arriba = zonas.filter((z) => z.valor > precio).sort((a, b) => a.valor - b.valor);
  if (arriba[0]) {
    niveles.push({ tipo: "resistencia", nombre: "Resistencia", ...arriba[0], origen: "pivotes" });
  } else {
    const maximo = Math.max(...ventana.map((p) => p.maximo));
    const { desde, hasta } = ensanchar(maximo, maximo);
    niveles.push({
      tipo: "resistencia",
      nombre: "Resistencia · máx. 6 meses",
      desde,
      hasta,
      valor: maximo,
      origen: "maximo",
      toques: 0,
    });
  }

  // Soportes de pivotes: las dos más cercanas y la de más toques del resto.
  const abajo = zonas.filter((z) => z.valor <= precio).sort((a, b) => b.valor - a.valor);
  const [inmediato, intermedio, ...resto] = abajo;
  // Un solo giro no hace un soporte "estructural": mínimo dos.
  const estructural = resto
    .filter((z) => z.toques >= 2)
    .sort((a, b) => b.toques - a.toques || b.valor - a.valor)[0];
  for (const [zona, nombre] of [
    [inmediato, "Soporte inmediato"],
    [intermedio, "Soporte intermedio"],
    [estructural, "Soporte estructural"],
  ] as const) {
    if (zona) niveles.push({ tipo: "soporte", nombre, ...zona, origen: "pivotes" });
  }

  return niveles.sort((a, b) => b.valor - a.valor);
}

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
