// Indicadores macro de EE.UU. para la pestaña QQQ / TQQQ: transforma las
// series crudas de FRED (/macro.json, generado en el deploy) en lecturas listas para mostrar. Funciones
// puras, sin React, igual que tecnico.ts.

import type { DatosMacro, SerieMacro } from "../../scripts/fred";

export type { DatosMacro, SerieMacro };

export interface Observacion {
  fecha: string;
  valor: number;
}

export type Frecuencia = "diaria" | "semanal" | "mensual" | "trimestral";

export type Grupo = "Política monetaria y tasas" | "Inflación" | "Empleo" | "Crecimiento, consumo y mercado";
export const GRUPOS: Grupo[] = [
  "Política monetaria y tasas",
  "Inflación",
  "Empleo",
  "Crecimiento, consumo y mercado",
];

export interface LecturaMacro {
  id: string;
  grupo: Grupo;
  titulo: string;
  valor: string;
  /** Periodo al que corresponde el dato (no la fecha de publicación). */
  periodo: string;
  /** "▲ 0.1 pts vs ago 2026". Neutro a propósito: un buen dato de empleo
   * puede ser "malo" para el índice (Fed más dura), así que no se colorea. */
  cambio: string | null;
  /** Si el cambio es buena o mala noticia para el Nasdaq-100 (verde/rojo);
   * null = sin cambio o indicador sin dirección clara (la curva). */
  tono: "favorable" | "desfavorable" | null;
  detalle: string;
  /** Qué es y por qué le importa a la Fed / al mercado. */
  descripcion: string;
  /** Últimos ~2 años, para la minigráfica. */
  historia: Observacion[];
  /** Nivel de referencia que se dibuja en la minigráfica (meta de 2%, 0...). */
  referencia?: number;
  formatoHistoria: (v: number) => string;
}

// --------------------------------------------------------------- formatos

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function nombrePeriodo(fecha: string, frecuencia: Frecuencia): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (frecuencia === "trimestral") return `T${Math.floor((mes - 1) / 3) + 1} ${anio}`;
  if (frecuencia === "mensual") return `${MESES_CORTOS[mes - 1]} ${anio}`;
  return `${dia} ${MESES_CORTOS[mes - 1]} ${anio}`;
}

const dec1 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

const porcentaje1 = (v: number) => `${dec1.format(v)}%`;
const porcentaje2 = (v: number) => `${dec2.format(v)}%`;
/** `texto` ya viene en valor absoluto; aquí se le pone el signo de `v`. */
const conSigno = (texto: string, v: number) => (v > 0 ? `+${texto}` : v < 0 ? `−${texto}` : texto);

function flecha(diferencia: number): string {
  return diferencia > 0 ? "▲" : diferencia < 0 ? "▼" : "=";
}

// ---------------------------------------------------------- transformaciones

export function observaciones(datos: DatosMacro, id: SerieMacro): Observacion[] {
  return (datos.series[id] ?? []).map(([fecha, valor]) => ({ fecha, valor }));
}

/** Variación anual (%) de una serie mensual: cada mes contra el mismo mes del
 * año anterior (se busca por fecha, no por posición, por si falta algún mes). */
export function variacionAnual(obs: Observacion[]): Observacion[] {
  const porFecha = new Map(obs.map((o) => [o.fecha, o.valor]));
  return obs.flatMap((o) => {
    const previo = porFecha.get(`${Number(o.fecha.slice(0, 4)) - 1}${o.fecha.slice(4)}`);
    return previo ? [{ fecha: o.fecha, valor: (o.valor / previo - 1) * 100 }] : [];
  });
}

/** Diferencia contra la observación anterior (p. ej. empleos creados en el mes). */
export function diferencias(obs: Observacion[]): Observacion[] {
  return obs.slice(1).map((o, i) => ({ fecha: o.fecha, valor: o.valor - obs[i].valor }));
}

/** Variación % contra la observación anterior (p. ej. ventas mes a mes). */
export function variacionPeriodo(obs: Observacion[]): Observacion[] {
  return obs.slice(1).map((o, i) => ({ fecha: o.fecha, valor: (o.valor / obs[i].valor - 1) * 100 }));
}

/** Último dato de cada mes (para resumir series diarias en la minigráfica). */
export function finDeMes(obs: Observacion[]): Observacion[] {
  const porMes = new Map<string, Observacion>();
  for (const o of obs) porMes.set(o.fecha.slice(0, 7), o);
  return Array.from(porMes.values());
}

/** Último cambio de nivel de una serie escalonada (la tasa de la Fed): cuánto
 * se movió y desde qué fecha rige. null si no cambió en toda la historia. */
export function ultimoCambio(obs: Observacion[]): { fecha: string; diferencia: number } | null {
  const actual = obs[obs.length - 1]?.valor;
  for (let i = obs.length - 2; i >= 0; i--) {
    if (obs[i].valor !== actual) return { fecha: obs[i + 1].fecha, diferencia: actual - obs[i].valor };
  }
  return null;
}

// ---------------------------------------------------------- definiciones

interface Definicion {
  id: string;
  grupo: Grupo;
  titulo: string;
  serie: SerieMacro;
  frecuencia: Frecuencia;
  transformar?: (obs: Observacion[]) => Observacion[];
  formato: (v: number) => string;
  /** Unidad del cambio vs. el dato anterior: puntos porcentuales o la misma
   * unidad del valor. */
  formatoCambio: (diferencia: number) => string;
  /** Dirección que suele ser buena noticia para el índice: menos inflación,
   * tasas y volatilidad; más crecimiento y empleo. Sin ella, sin color (la
   * curva 10a−2a: que se empine puede ser por recortes o por miedo). */
  favorableSi?: "sube" | "baja";
  detalle?: (ultimo: Observacion) => string;
  descripcion: string;
  referencia?: number;
  /** Cuántas observaciones se ven en la minigráfica. */
  historia: number;
}

const pts = (d: number) => `${dec2.format(Math.abs(d))} pts`;
const pts1 = (d: number) => `${dec1.format(Math.abs(d))} pts`;
const miles = (v: number) => `${entero.format(v)} mil`;
const millones = (v: number) => `${dec1.format(v / 1000)} M`;

const DEFINICIONES: Definicion[] = [
  {
    id: "DGS2",
    grupo: "Política monetaria y tasas",
    titulo: "Bono del Tesoro 2 años",
    serie: "DGS2",
    frecuencia: "diaria",
    formato: porcentaje2,
    formatoCambio: pts,
    favorableSi: "baja",
    descripcion:
      "Rendimiento a 2 años: refleja lo que el mercado espera de la tasa de la Fed en los próximos meses.",
    historia: 24,
  },
  {
    id: "DGS10",
    grupo: "Política monetaria y tasas",
    titulo: "Bono del Tesoro 10 años",
    serie: "DGS10",
    frecuencia: "diaria",
    formato: porcentaje2,
    formatoCambio: pts,
    favorableSi: "baja",
    descripcion:
      "Tasa de descuento de largo plazo: cuando sube, pesa sobre las valuaciones de tecnológicas (Nasdaq-100).",
    historia: 24,
  },
  {
    id: "T10Y2Y",
    grupo: "Política monetaria y tasas",
    titulo: "Curva 10 años − 2 años",
    serie: "T10Y2Y",
    frecuencia: "diaria",
    formato: (v) => conSigno(pts(v), v),
    formatoCambio: pts,
    detalle: (u) => (u.valor < 0 ? "Invertida" : "Positiva"),
    descripcion:
      "Diferencial entre el bono a 10 y a 2 años. Invertida (negativa) históricamente ha antecedido recesiones.",
    referencia: 0,
    historia: 24,
  },
  {
    id: "PCEPILFE",
    grupo: "Inflación",
    titulo: "PCE subyacente (anual)",
    serie: "PCEPILFE",
    frecuencia: "mensual",
    transformar: variacionAnual,
    formato: porcentaje1,
    formatoCambio: pts1,
    favorableSi: "baja",
    detalle: () => "La medida preferida de la Fed · meta 2%",
    descripcion:
      "Inflación del gasto de consumo sin alimentos ni energía. Es la que la Fed usa para su meta de 2%.",
    referencia: 2,
    historia: 24,
  },
  {
    id: "PCEPI",
    grupo: "Inflación",
    titulo: "PCE general (anual)",
    serie: "PCEPI",
    frecuencia: "mensual",
    transformar: variacionAnual,
    formato: porcentaje1,
    formatoCambio: pts1,
    favorableSi: "baja",
    detalle: () => "Meta de la Fed: 2%",
    descripcion: "Inflación del gasto de consumo, incluyendo alimentos y energía.",
    referencia: 2,
    historia: 24,
  },
  {
    id: "CPILFESL",
    grupo: "Inflación",
    titulo: "CPI subyacente (anual)",
    serie: "CPILFESL",
    frecuencia: "mensual",
    transformar: variacionAnual,
    formato: porcentaje1,
    formatoCambio: pts1,
    favorableSi: "baja",
    descripcion:
      "Precios al consumidor sin alimentos ni energía. Sale antes que el PCE y suele mover más al mercado el día del dato.",
    referencia: 2,
    historia: 24,
  },
  {
    id: "CPIAUCSL",
    grupo: "Inflación",
    titulo: "CPI general (anual)",
    serie: "CPIAUCSL",
    frecuencia: "mensual",
    transformar: variacionAnual,
    formato: porcentaje1,
    formatoCambio: pts1,
    favorableSi: "baja",
    descripcion: "Índice de precios al consumidor completo (la inflación \"de titular\").",
    referencia: 2,
    historia: 24,
  },
  {
    id: "PAYEMS",
    grupo: "Empleo",
    titulo: "Nómina no agrícola",
    serie: "PAYEMS",
    frecuencia: "mensual",
    transformar: diferencias,
    formato: (v) => conSigno(miles(Math.abs(v)), v),
    formatoCambio: (d) => miles(Math.abs(d)),
    favorableSi: "sube",
    detalle: () => "Empleos creados en el mes",
    descripcion:
      "Empleos creados en el mes (reporte de empleo, primer viernes). Es el dato que más mueve al mercado en el mes.",
    referencia: 0,
    historia: 24,
  },
  {
    id: "UNRATE",
    grupo: "Empleo",
    titulo: "Tasa de desempleo",
    serie: "UNRATE",
    frecuencia: "mensual",
    formato: porcentaje1,
    formatoCambio: pts1,
    favorableSi: "baja",
    descripcion: "La otra mitad del mandato dual de la Fed (máximo empleo).",
    historia: 24,
  },
  {
    id: "ICSA",
    grupo: "Empleo",
    titulo: "Solicitudes de desempleo",
    serie: "ICSA",
    frecuencia: "semanal",
    formato: (v) => miles(v / 1000),
    formatoCambio: (d) => miles(Math.abs(d) / 1000),
    favorableSi: "baja",
    detalle: () => "Solicitudes iniciales, semanal",
    descripcion:
      "Nuevas solicitudes de seguro de desempleo cada semana: el termómetro más rápido del mercado laboral.",
    historia: 52,
  },
  {
    id: "CES0500000003",
    grupo: "Empleo",
    titulo: "Salario por hora (anual)",
    serie: "CES0500000003",
    frecuencia: "mensual",
    transformar: variacionAnual,
    formato: porcentaje1,
    formatoCambio: pts1,
    favorableSi: "baja",
    descripcion:
      "Crecimiento anual del salario promedio por hora. Salarios altos alimentan la inflación de servicios.",
    historia: 24,
  },
  {
    id: "JTSJOL",
    grupo: "Empleo",
    titulo: "Vacantes (JOLTS)",
    serie: "JTSJOL",
    frecuencia: "mensual",
    formato: millones,
    formatoCambio: (d) => miles(Math.abs(d)),
    favorableSi: "sube",
    descripcion: "Puestos de trabajo abiertos. Menos vacantes = mercado laboral menos apretado.",
    historia: 24,
  },
  {
    id: "A191RL1Q225SBEA",
    grupo: "Crecimiento, consumo y mercado",
    titulo: "PIB real (trimestral anualizado)",
    serie: "A191RL1Q225SBEA",
    frecuencia: "trimestral",
    formato: porcentaje1,
    formatoCambio: pts1,
    favorableSi: "sube",
    descripcion: "Crecimiento de la economía, variación trimestral a tasa anual.",
    referencia: 0,
    historia: 12,
  },
  {
    id: "RSAFS",
    grupo: "Crecimiento, consumo y mercado",
    titulo: "Ventas minoristas (mensual)",
    serie: "RSAFS",
    frecuencia: "mensual",
    transformar: variacionPeriodo,
    formato: (v) => conSigno(porcentaje1(Math.abs(v)), v),
    formatoCambio: pts1,
    favorableSi: "sube",
    descripcion: "Variación mensual de las ventas al menudeo: pulso del consumo, ~70% del PIB.",
    referencia: 0,
    historia: 24,
  },
  {
    id: "UMCSENT",
    grupo: "Crecimiento, consumo y mercado",
    titulo: "Sentimiento del consumidor",
    serie: "UMCSENT",
    frecuencia: "mensual",
    formato: (v) => dec1.format(v),
    formatoCambio: (d) => dec1.format(Math.abs(d)),
    favorableSi: "sube",
    detalle: () => "Universidad de Michigan",
    descripcion: "Encuesta de confianza del consumidor; incluye sus expectativas de inflación.",
    historia: 24,
  },
  {
    id: "VIXCLS",
    grupo: "Crecimiento, consumo y mercado",
    titulo: "VIX",
    serie: "VIXCLS",
    frecuencia: "diaria",
    formato: (v) => dec2.format(v),
    formatoCambio: (d) => dec2.format(Math.abs(d)),
    favorableSi: "baja",
    detalle: (u) => (u.valor >= 30 ? "Miedo alto (≥ 30)" : u.valor >= 20 ? "Nerviosismo (20–30)" : "Calma (< 20)"),
    descripcion: "Volatilidad implícita del S&P 500 a 30 días, el \"índice del miedo\".",
    historia: 24,
  },
];

/** Si redondeado no se movió ("0.0 pts"), ni flecha ni color. */
function sinCambio(def: Definicion, diferencia: number): boolean {
  return Number(def.formatoCambio(diferencia).replace(/[^\d.]/g, "")) === 0;
}

function tonoDe(favorableSi: "sube" | "baja" | undefined, diferencia: number): LecturaMacro["tono"] {
  if (!favorableSi || diferencia === 0) return null;
  return (diferencia > 0) === (favorableSi === "sube") ? "favorable" : "desfavorable";
}

function textoCambio(def: Definicion, diferencia: number, base: Observacion): string {
  const contra =
    def.frecuencia === "diaria"
      ? `cierre de ${nombrePeriodo(base.fecha, "mensual")}`
      : nombrePeriodo(base.fecha, def.frecuencia);
  const texto = def.formatoCambio(diferencia);
  if (sinCambio(def, diferencia)) return `= sin cambio vs ${contra}`;
  return `${flecha(diferencia)} ${texto} vs ${contra}`;
}

function lecturaDeSerie(def: Definicion, crudas: Observacion[]): LecturaMacro | null {
  const obs = def.transformar ? def.transformar(crudas) : crudas;
  const ultimo = obs[obs.length - 1];
  if (!ultimo) return null;
  const anterior = obs[obs.length - 2];
  const historia =
    def.frecuencia === "diaria" ? finDeMes(obs).slice(-def.historia) : obs.slice(-def.historia);
  // En series diarias se compara contra el cierre del mes anterior (contra
  // el día anterior el cambio casi siempre sería ruido).
  const base =
    def.frecuencia === "diaria"
      ? finDeMes(obs).filter((o) => o.fecha.slice(0, 7) < ultimo.fecha.slice(0, 7)).pop()
      : anterior;
  const diferencia = base ? ultimo.valor - base.valor : null;
  return {
    id: def.id,
    grupo: def.grupo,
    titulo: def.titulo,
    valor: def.formato(ultimo.valor),
    periodo: nombrePeriodo(ultimo.fecha, def.frecuencia),
    cambio: base && diferencia != null ? textoCambio(def, diferencia, base) : null,
    tono:
      diferencia != null && !sinCambio(def, diferencia) ? tonoDe(def.favorableSi, diferencia) : null,
    detalle: def.detalle?.(ultimo) ?? "",
    descripcion: def.descripcion,
    historia,
    referencia: def.referencia,
    formatoHistoria: def.formato,
  };
}

/** Tasa de la Fed (rango objetivo) y tasa real = punto medio − PCE subyacente
 * anual: cuánto "aprieta" la política monetaria. */
function lecturasFed(datos: DatosMacro): LecturaMacro[] {
  const superior = observaciones(datos, "DFEDTARU");
  const inferior = observaciones(datos, "DFEDTARL");
  const u = superior[superior.length - 1];
  const l = inferior[inferior.length - 1];
  if (!u || !l) return [];
  const cambio = ultimoCambio(superior);
  const salida: LecturaMacro[] = [
    {
      id: "FED",
      grupo: "Política monetaria y tasas",
      titulo: "Tasa de la Fed",
      valor: `${dec2.format(l.valor)}–${porcentaje2(u.valor)}`,
      periodo: `Rango objetivo al ${nombrePeriodo(u.fecha, "diaria")}`,
      cambio: cambio
        ? `Último movimiento: ${flecha(cambio.diferencia)} ${pts(cambio.diferencia)} el ${nombrePeriodo(cambio.fecha, "diaria")}`
        : "Sin cambios en los últimos 4 años",
      // Un recorte (▼) es buena noticia para el índice; un alza, mala.
      tono: cambio ? tonoDe("baja", cambio.diferencia) : null,
      detalle: "",
      descripcion:
        "Rango objetivo de la tasa de fondos federales que fija el FOMC. Recortes suelen favorecer al Nasdaq; alzas, presionarlo.",
      historia: finDeMes(superior).slice(-24),
      formatoHistoria: porcentaje2,
    },
  ];
  const pce = variacionAnual(observaciones(datos, "PCEPILFE"));
  const pceUltimo = pce[pce.length - 1];
  if (pceUltimo) {
    const superiorPorMes = new Map(finDeMes(superior).map((o) => [o.fecha.slice(0, 7), o.valor]));
    const inferiorPorMes = new Map(finDeMes(inferior).map((o) => [o.fecha.slice(0, 7), o.valor]));
    const historia = pce.flatMap((p) => {
      const mes = p.fecha.slice(0, 7);
      const [sup, inf] = [superiorPorMes.get(mes), inferiorPorMes.get(mes)];
      return sup == null || inf == null ? [] : [{ fecha: p.fecha, valor: (sup + inf) / 2 - p.valor }];
    });
    const real = (u.valor + l.valor) / 2 - pceUltimo.valor;
    salida.push({
      id: "REAL",
      grupo: "Política monetaria y tasas",
      titulo: "Tasa real",
      valor: conSigno(porcentaje2(Math.abs(real)), real),
      periodo: `Punto medio de la Fed − PCE subyacente de ${nombrePeriodo(pceUltimo.fecha, "mensual")}`,
      cambio: null,
      tono: null,
      detalle: real > 0 ? "Política restrictiva (positiva)" : "Política laxa (negativa)",
      descripcion:
        "Tasa de la Fed descontando la inflación. Mientras más positiva, más frena la economía.",
      historia: historia.slice(-24),
      referencia: 0,
      formatoHistoria: porcentaje2,
    });
  }
  return salida;
}

export function calcularLecturasMacro(datos: DatosMacro): LecturaMacro[] {
  const lecturas = [...lecturasFed(datos)];
  for (const def of DEFINICIONES) {
    const lectura = lecturaDeSerie(def, observaciones(datos, def.serie));
    if (lectura) lecturas.push(lectura);
  }
  return lecturas;
}

// ---------------------------------------------------------------- datos

let cache: DatosMacro | null = null;

/** Lee /macro.json, que el workflow de deploy genera desde FRED (al publicar y
 * dos veces al día en días hábiles). Cambia solo con un deploy, así que basta
 * con bajarlo una vez por sesión. */
export async function obtenerDatosMacro(): Promise<DatosMacro> {
  if (cache) return cache;
  const respuesta = await fetch("/macro.json", { cache: "no-cache" });
  const cuerpo = (await respuesta.json().catch(() => null)) as DatosMacro | null;
  if (!respuesta.ok || !cuerpo?.series) {
    throw new Error(
      respuesta.status === 404
        ? "todavía no se han generado (el deploy no pudo descargar FRED)"
        : `error ${respuesta.status} al leer /macro.json`
    );
  }
  cache = cuerpo;
  return cuerpo;
}
