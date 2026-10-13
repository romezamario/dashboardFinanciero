// Pestaña "Agente de trading": el saldo de la cuenta simulada del agente
// (repo aparte, romezamario/trading-agent). Aquí solo se lee y se resume;
// el agente decide y calcula todo en su propio repo.
import type { CuentaAlpaca, OrdenAgente, OrdenAlpaca, PosicionAgente, SaldoAgente } from "../../functions/api/agente-saldo";
import type { PuntoHistorialAlpaca, RangoAlpaca } from "../../functions/api/alpaca-historial";

export interface ResumenAgente {
  saldoActual: number;
  saldoInicial: number;
  /** Cambio vs. el saldo inicial, como fracción (0.1 = +10%). */
  cambio: number;
  /** Peor caída desde un máximo previo, como fracción negativa. */
  peorCaida: number;
  /** Qué fracción de la meta lleva (saldo actual / meta). */
  avanceMeta: number;
  desde: string;
  hasta: string;
}

export function resumirSaldo(saldo: SaldoAgente): ResumenAgente | null {
  const serie = saldo.series;
  if (serie.length === 0) return null;
  const saldoActual = serie[serie.length - 1].balance;
  const saldoInicial = saldo.initial_balance;
  let maximo = -Infinity;
  let peorCaida = 0;
  for (const p of serie) {
    maximo = Math.max(maximo, p.balance);
    peorCaida = Math.min(peorCaida, p.balance / maximo - 1);
  }
  return {
    saldoActual,
    saldoInicial,
    cambio: saldoActual / saldoInicial - 1,
    peorCaida,
    avanceMeta: saldo.goal > 0 ? saldoActual / saldo.goal : 0,
    desde: serie[0].date,
    hasta: serie[serie.length - 1].date,
  };
}

/** Fracción de la cuenta que no está invertida (lo que suman las posiciones, al revés). */
export function fraccionEnEfectivo(posiciones: PosicionAgente[]): number {
  return Math.max(0, 1 - posiciones.reduce((suma, p) => suma + p.weight, 0));
}

/** Órdenes de la más reciente a la más vieja (el agente las escribe en orden de ejecución). */
export function ordenesRecientesPrimero(ordenes: OrdenAgente[]): OrdenAgente[] {
  return ordenes
    .map((orden, i) => ({ orden, i }))
    .sort((a, b) => b.orden.date.localeCompare(a.orden.date) || b.i - a.i)
    .map(({ orden }) => orden);
}

export interface ResumenGanancias {
  /** Suma de la ganancia/pérdida de todas las ventas. */
  realizada: number;
  /** Valor actual − costo de lo que sigue abierto. */
  noRealizada: number;
  /** El resto del cambio del saldo: el efectivo se guarda en dólares, así que se mueve con el tipo de cambio. */
  tipoDeCambio: number;
}

/** Desglosa el cambio del saldo en ganancia realizada, no realizada y efecto del tipo de cambio.
 * null si el agente todavía no exporta ganancias (versiones anteriores de balance.json). */
export function resumirGanancias(saldo: SaldoAgente): ResumenGanancias | null {
  const ordenes = saldo.trades ?? [];
  const posiciones = saldo.positions ?? [];
  const tieneDatos =
    ordenes.some((o) => o.pnl_mxn !== undefined) || posiciones.some((p) => p.unrealized_pnl_mxn != null);
  if (!tieneDatos) return null;
  const realizada = ordenes.reduce((suma, o) => suma + (o.pnl_mxn ?? 0), 0);
  const noRealizada = posiciones.reduce((suma, p) => suma + (p.unrealized_pnl_mxn ?? 0), 0);
  const cambioTotal = saldo.current_balance - saldo.initial_balance;
  return { realizada, noRealizada, tipoDeCambio: cambioTotal - realizada - noRealizada };
}

/** "BTC" en vez de "btc". */
export function nombreActivo(activo: string): string {
  return activo.toUpperCase();
}

export interface ResumenAlpaca {
  valor: number;
  efectivo: number;
  /** Cambio vs. el cierre del día hábil anterior (null si Alpaca no lo dio). */
  cambioDia: number | null;
  cambioDiaPct: number | null;
  /** Suma de la ganancia no realizada de las posiciones abiertas. */
  noRealizada: number;
}

export function resumirAlpaca(cuenta: CuentaAlpaca): ResumenAlpaca {
  const valor = cuenta.equity ?? 0;
  const anterior = cuenta.last_equity;
  const cambioDia = anterior ? valor - anterior : null;
  return {
    valor,
    efectivo: cuenta.cash ?? 0,
    cambioDia,
    cambioDiaPct: anterior && cambioDia !== null ? cambioDia / anterior : null,
    noRealizada: cuenta.posiciones.reduce((suma, p) => suma + (p.unrealized_pl ?? 0), 0),
  };
}

/** "BTCUSD" o "BTC/USD" → "BTC"; "QQQ" se queda igual. */
export function nombreSimboloAlpaca(simbolo: string): string {
  return simbolo.replace(/\/?USD$/, "") || simbolo;
}

export interface GananciaVenta {
  pnl: number;
  pct: number;
}

/** Ganancia o pérdida de cada venta ejecutada de Alpaca contra el precio promedio de compra de ese
 * activo (costo promedio, como lo calcula Alpaca), antes de comisiones. Devuelve un arreglo
 * alineado con `ordenes`: null en compras, en órdenes sin ejecutar y en ventas cuyas compras ya no
 * vienen en la lista (solo trae las últimas 100 órdenes, y sin el costo no se puede calcular). */
export function gananciasDeVentasAlpaca(ordenes: OrdenAlpaca[]): (GananciaVenta | null)[] {
  const resultado: (GananciaVenta | null)[] = ordenes.map(() => null);
  const ejecutadas = ordenes
    .map((orden, i) => ({ orden, i }))
    .filter(({ orden }) => orden.filled_qty && orden.filled_avg_price != null)
    .sort((a, b) => (a.orden.filled_at ?? a.orden.submitted_at ?? "").localeCompare(b.orden.filled_at ?? b.orden.submitted_at ?? ""));
  const tenencia = new Map<string, { cantidad: number; costo: number }>();
  for (const { orden, i } of ejecutadas) {
    const clave = nombreSimboloAlpaca(orden.symbol);
    const cantidad = orden.filled_qty as number;
    const precio = orden.filled_avg_price as number;
    const actual = tenencia.get(clave) ?? { cantidad: 0, costo: 0 };
    if (orden.side === "buy") {
      tenencia.set(clave, { cantidad: actual.cantidad + cantidad, costo: actual.costo + cantidad * precio });
      continue;
    }
    // Tolerancia de 1% por la comisión de criptos, que Alpaca cobra en el propio activo.
    if (actual.cantidad <= 0 || cantidad > actual.cantidad * 1.01) {
      tenencia.delete(clave);
      continue;
    }
    const promedio = actual.costo / actual.cantidad;
    const vendida = Math.min(cantidad, actual.cantidad);
    resultado[i] = { pnl: Math.round((precio - promedio) * cantidad * 100) / 100, pct: precio / promedio - 1 };
    tenencia.set(clave, { cantidad: actual.cantidad - vendida, costo: actual.costo - vendida * promedio });
  }
  return resultado;
}

const ESTADOS_ORDEN: Record<string, string> = {
  filled: "Ejecutada",
  partially_filled: "Ejecutada en parte",
  new: "En espera",
  accepted: "En espera (abre la bolsa)",
  pending_new: "Enviándose",
  done_for_day: "Terminó el día",
  canceled: "Cancelada",
  expired: "Venció",
  rejected: "Rechazada",
  replaced: "Reemplazada",
  pending_cancel: "Cancelándose",
  held: "Retenida",
};

/** Estado de una orden de Alpaca en español (el original si no se conoce). */
export function estadoOrdenAlpaca(estado: string | null): string {
  if (!estado) return "—";
  return ESTADOS_ORDEN[estado] ?? estado;
}

/** Trae el saldo de /api/agente-saldo (Pages Function). El error viene con
 * un mensaje en español listo para mostrarse. */
/** Valor de la cuenta de Alpaca en el rango pedido, con el detalle de Alpaca (cada 5 min en "1D"). */
export async function obtenerHistorialAlpaca(rango: RangoAlpaca): Promise<PuntoHistorialAlpaca[]> {
  const respuesta = await fetch(`/api/alpaca-historial?rango=${rango}`, { cache: "no-store" });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as PuntoHistorialAlpaca[] & { error?: string };
  if (!respuesta.ok) throw new Error(cuerpo.error ?? `El servidor respondió ${respuesta.status}`);
  return cuerpo;
}

/** El historial diario de output/alpaca.json ("2026-10-11") como puntos del eje de tiempo, al
 * mediodía local para que la fecha no se corra un día con la zona horaria. */
export function historialGuardadoComoPuntos(historial: { date: string; equity: number }[]): PuntoHistorialAlpaca[] {
  return historial.map((p) => ({ t: new Date(`${p.date}T12:00:00`).getTime(), valor: p.equity }));
}

/** La cuenta de Alpaca leída en este momento (botón "Actualizar"), no la foto de la última corrida. */
export async function obtenerAlpacaEnVivo(): Promise<CuentaAlpaca> {
  const respuesta = await fetch("/api/alpaca-en-vivo", { cache: "no-store" });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as CuentaAlpaca & { error?: string };
  if (!respuesta.ok) throw new Error(cuerpo.error ?? `El servidor respondió ${respuesta.status}`);
  return cuerpo;
}

export async function obtenerSaldoAgente(): Promise<SaldoAgente> {
  const respuesta = await fetch("/api/agente-saldo");
  const cuerpo = (await respuesta.json().catch(() => ({}))) as SaldoAgente & { error?: string };
  if (!respuesta.ok) throw new Error(cuerpo.error ?? `El servidor respondió ${respuesta.status}`);
  return cuerpo;
}
