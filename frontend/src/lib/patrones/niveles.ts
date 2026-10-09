import type { PuntoTecnico } from "../tecnico";
import { CONFIG_DETECCION, type ConfigDeteccion } from "./config";
import { detectarPivotes } from "./pivotes";
import { detectarRectangulos } from "./rectangulo";
import type { Pivote, Vela } from "./tipos";
import { velasDistintas } from "./util";

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
  /** Veces que el precio giró en la zona (pivotes que la sostienen). */
  toques: number;
  /** Los pivotes (con su vela) que sostienen el nivel, para poder auditarlo.
   * Vacío en un nivel que es solo una media o el máximo de la ventana. */
  pivotes: Pivote[];
  /** Velas exactas que lo originan: las de sus pivotes y, en una media, la
   * última vela (donde se lee su valor). */
  velasOrigen: Vela[];
  /** Por qué se clasificó así (distancia, toques, coincidencia con media). */
  motivo: string;
}

interface Zona {
  desde: number;
  hasta: number;
  valor: number;
  pivotes: Pivote[];
}

function ensanchar(desde: number, hasta: number, medioAnchoMinimo: number): { desde: number; hasta: number } {
  const centro = (desde + hasta) / 2;
  const medio = Math.max((hasta - desde) / 2, centro * medioAnchoMinimo);
  return { desde: centro - medio, hasta: centro + medio };
}

/** Junta pivotes cercanos (a menos de `tolerancia`) en zonas. */
function agruparEnZonas(pivotes: Pivote[], tolerancia: number, medioAnchoMinimo: number): Zona[] {
  const ordenados = [...pivotes].sort((a, b) => a.precio - b.precio);
  const grupos: Pivote[][] = [];
  for (const p of ordenados) {
    const actual = grupos[grupos.length - 1];
    if (actual && p.precio - actual[actual.length - 1].precio <= tolerancia) actual.push(p);
    else grupos.push([p]);
  }
  return grupos.map((g) => {
    const { desde, hasta } = ensanchar(g[0].precio, g[g.length - 1].precio, medioAnchoMinimo);
    return { desde, hasta, valor: (desde + hasta) / 2, pivotes: g };
  });
}

const porcentaje = (v: number) => `${(Math.abs(v) * 100).toFixed(1)}%`;

/**
 * Soportes y resistencias de las últimas `niveles.sesiones` sesiones, para
 * dibujar sobre la gráfica de precio. Todo sale de `config` y de las velas:
 * - zonas = pivotes (fractales de `pivotes.ventana`) agrupados si están a
 *   menos de `agruparAtr` × ATR(14);
 * - resistencia = la zona más cercana por encima del cierre (o el máximo de la
 *   ventana si el precio está en máximos);
 * - soporte inmediato e intermedio = las dos zonas más cercanas por debajo;
 * - soporte estructural = el piso del rango lateral (rectángulo) si lo hay;
 *   si no, la zona de más toques (mínimo `minToquesEstructural`) entre el resto;
 * - SMA 50 y SMA 200 como soporte (o resistencia) dinámico; si una zona de
 *   pivotes coincide con la media (a menos de `fusionarSmaAtr` × ATR), se
 *   fusiona en ella y suma sus toques.
 * Cada nivel guarda los pivotes y velas que lo sustentan (trazabilidad).
 * Ordenados de arriba a abajo.
 */
export function calcularNiveles(
  puntos: PuntoTecnico[],
  config: ConfigDeteccion = CONFIG_DETECCION
): NivelTecnico[] {
  const c = config.niveles;
  const ventana = puntos.slice(-c.sesiones);
  const ultimo = ventana[ventana.length - 1];
  if (!ultimo || ventana.length < config.pivotes.ventana * 4) return [];
  const precio = ultimo.cierre;
  const atrActual = ultimo.atr ?? precio * 0.01;
  let zonas = agruparEnZonas(detectarPivotes(ventana, config.pivotes.ventana), atrActual * c.agruparAtr, c.medioAnchoMinimo);
  const niveles: NivelTecnico[] = [];

  const distancia = (valor: number) =>
    `a ${porcentaje(valor / precio - 1)} del cierre (${(Math.abs(valor - precio) / atrActual).toFixed(1)} ATR)`;
  const giros = (n: number) => `${n} giro${n === 1 ? "" : "s"} del precio en la zona`;

  // Medias móviles: absorben la zona de pivotes que les quede pegada.
  const medias: { origen: "sma50" | "sma200"; valor: number | null }[] = [
    { origen: "sma50", valor: ultimo.sma50 },
    { origen: "sma200", valor: ultimo.sma200 },
  ];
  for (const { origen, valor } of medias) {
    if (valor == null) continue;
    let { desde, hasta } = ensanchar(valor, valor, c.medioAnchoMinimo);
    const cercanas = zonas.filter(
      (z) => Math.abs(z.valor - valor) <= atrActual * c.fusionarSmaAtr + (z.hasta - z.desde) / 2
    );
    for (const z of cercanas) {
      desde = Math.min(desde, z.desde);
      hasta = Math.max(hasta, z.hasta);
    }
    zonas = zonas.filter((z) => !cercanas.includes(z));
    const soporte = valor < precio;
    const etiqueta = origen === "sma50" ? "SMA 50" : "SMA 200";
    const pivotes = cercanas.flatMap((z) => z.pivotes);
    niveles.push({
      tipo: soporte ? "soporte" : "resistencia",
      nombre: `${soporte ? (origen === "sma50" ? "Soporte mayor" : "Soporte largo plazo") : "Resistencia"} · ${etiqueta}`,
      desde,
      hasta,
      valor,
      origen,
      toques: pivotes.length,
      pivotes,
      velasOrigen: velasDistintas([], [ultimo, ...pivotes.map((p) => p.vela)]),
      motivo: `${etiqueta} (${valor.toFixed(2)}) ${distancia(valor)}${pivotes.length ? `; coincide con ${giros(pivotes.length)}` : ""}`,
    });
  }

  // Resistencia: la zona más cercana por encima; si no hay (precio en
  // máximos), el máximo de la ventana.
  const arriba = zonas.filter((z) => z.valor > precio).sort((a, b) => a.valor - b.valor);
  if (arriba[0]) {
    const z = arriba[0];
    niveles.push({
      tipo: "resistencia",
      nombre: "Resistencia",
      desde: z.desde,
      hasta: z.hasta,
      valor: z.valor,
      origen: "pivotes",
      toques: z.pivotes.length,
      pivotes: z.pivotes,
      velasOrigen: velasDistintas([], z.pivotes.map((p) => p.vela)),
      motivo: `Zona más cercana por encima del cierre, ${distancia(z.valor)}; ${giros(z.pivotes.length)}`,
    });
  } else {
    const velaMaxima = ventana.reduce((m, p) => (p.maximo > m.maximo ? p : m), ventana[0]);
    const { desde, hasta } = ensanchar(velaMaxima.maximo, velaMaxima.maximo, c.medioAnchoMinimo);
    niveles.push({
      tipo: "resistencia",
      nombre: "Resistencia · máx. 6 meses",
      desde,
      hasta,
      valor: velaMaxima.maximo,
      origen: "maximo",
      toques: 0,
      pivotes: [],
      velasOrigen: [velaMaxima],
      motivo: `Máximo de las últimas ${ventana.length} sesiones (${velaMaxima.fecha}): el precio está en máximos y no hay zona por encima`,
    });
  }

  // Soporte estructural = piso del rango lateral, si hay un rectángulo con el
  // piso por debajo del cierre (el más reciente).
  let abajo = zonas.filter((z) => z.valor <= precio).sort((a, b) => b.valor - a.valor);
  const rango = detectarRectangulos(ventana, config)
    .filter((r) => r.zonas[0] && r.zonas[0].minimo < precio)
    .sort((a, b) => b.indiceFin - a.indiceFin)[0];
  let estructural: NivelTecnico | null = null;
  if (rango) {
    const piso = rango.zonas[0].minimo;
    const pisosDelRango: Pivote[] = rango.puntos
      .filter((p) => p.etiqueta.startsWith("Piso"))
      .map((p) => ({ indice: p.indice, fecha: p.fecha, tipo: "minimo", precio: p.precio, vela: p.vela }));
    const cercana = abajo.find(
      (z) => Math.abs(z.valor - piso) <= atrActual * c.agruparAtr + (z.hasta - z.desde) / 2
    );
    const pivotes = [...pisosDelRango, ...(cercana ? cercana.pivotes.filter((p) => !pisosDelRango.some((q) => q.indice === p.indice)) : [])];
    const { desde, hasta } = ensanchar(
      Math.min(piso, ...pivotes.map((p) => p.precio)),
      Math.max(piso, ...pivotes.map((p) => p.precio)),
      c.medioAnchoMinimo
    );
    if (cercana) abajo = abajo.filter((z) => z !== cercana);
    estructural = {
      tipo: "soporte",
      nombre: "Soporte estructural",
      desde,
      hasta,
      valor: (desde + hasta) / 2,
      origen: "pivotes",
      toques: pivotes.length,
      pivotes,
      velasOrigen: velasDistintas([], pivotes.map((p) => p.vela)),
      motivo: `Piso del rango lateral del ${rango.fechaInicio} al ${rango.fechaFin} (${pisosDelRango.length} toques), ${distancia((desde + hasta) / 2)}`,
    };
  }

  // Soportes de pivotes: las dos más cercanas; y, sin rango lateral, la de más
  // toques del resto como estructural.
  const [inmediato, intermedio, ...resto] = abajo;
  if (!estructural) {
    const z = resto
      .filter((r) => r.pivotes.length >= c.minToquesEstructural)
      .sort((a, b) => b.pivotes.length - a.pivotes.length || b.valor - a.valor)[0];
    if (z) {
      estructural = {
        tipo: "soporte",
        nombre: "Soporte estructural",
        desde: z.desde,
        hasta: z.hasta,
        valor: z.valor,
        origen: "pivotes",
        toques: z.pivotes.length,
        pivotes: z.pivotes,
        velasOrigen: velasDistintas([], z.pivotes.map((p) => p.vela)),
        motivo: `Zona con más toques entre los soportes restantes (${z.pivotes.length}), ${distancia(z.valor)}`,
      };
    }
  }
  for (const [zona, nombre, ordinal] of [
    [inmediato, "Soporte inmediato", "más cercana"],
    [intermedio, "Soporte intermedio", "segunda más cercana"],
  ] as const) {
    if (!zona) continue;
    niveles.push({
      tipo: "soporte",
      nombre,
      desde: zona.desde,
      hasta: zona.hasta,
      valor: zona.valor,
      origen: "pivotes",
      toques: zona.pivotes.length,
      pivotes: zona.pivotes,
      velasOrigen: velasDistintas([], zona.pivotes.map((p) => p.vela)),
      motivo: `Zona ${ordinal} por debajo del cierre, ${distancia(zona.valor)}; ${giros(zona.pivotes.length)}`,
    });
  }
  if (estructural) niveles.push(estructural);

  return niveles.sort((a, b) => b.valor - a.valor);
}
