import type { GastoCorreo } from "./gastosCorreo";
import { aMovimiento, diasEntre, ultimaFechaPorCuenta, type MovimientoDia } from "./gastosEstadoCuenta";
import type { PuntoDimension } from "./queries";
import type { Transaccion } from "./types";

// Posible coincidencia entre un cargo de estado de cuenta y un aviso de compra
// del correo (vista "Por estado de cuenta" -> clic en el movimiento). No hay un
// folio común entre los dos, así que se empareja por lo único que comparten:
// el MONTO exacto y la FECHA, con un día de tolerancia (el aviso trae la fecha
// de la compra y el estado de cuenta la suya, que puede correrse por la zona
// horaria o la hora de corte). Es una pista, no una conciliación: por eso la
// pantalla la llama "posible coincidencia".

/** Cuántos días de diferencia se aceptan entre el cargo y el aviso. */
export const TOLERANCIA_DIAS = 1;

export interface Coincidencia {
  gasto: GastoCorreo;
  /** 0 = el mismo día; 1 = un día antes o después. */
  diasDeDiferencia: number;
  /** Otros avisos sin pareja que también encajaban (mismo monto, ±1 día). */
  otrosCandidatos: number;
}

const centavos = (monto: number) => Math.round(monto * 100);
const porFechaHora = (a: GastoCorreo, b: GastoCorreo) =>
  a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora) || a.id.localeCompare(b.id);

/**
 * Empareja cargos de TDC con avisos de correo: `Map<id del movimiento, Coincidencia>`.
 * - Solo cargos de tarjeta de crédito (los avisos son de TDC; los de la cuenta de
 *   cheques no traen establecimiento y no se suben) y avisos en pesos.
 * - Uno a uno: un aviso se empareja con un solo cargo, así dos cargos iguales el
 *   mismo día con un solo aviso no "comparten" el aviso. Primero se asignan los
 *   del mismo día y luego los de ±1 día.
 * - Determinista: los empates se resuelven por fecha, hora e id.
 */
export function conciliarConCorreo(
  movimientos: MovimientoDia[],
  gastos: GastoCorreo[]
): Map<string, Coincidencia> {
  const gastosPorMonto = new Map<number, GastoCorreo[]>();
  for (const g of gastos) {
    const c = centavos(g.monto);
    if (c <= 0 || (g.moneda && g.moneda !== "MXN")) continue;
    const lista = gastosPorMonto.get(c);
    if (lista) lista.push(g);
    else gastosPorMonto.set(c, [g]);
  }

  const movsPorMonto = new Map<number, MovimientoDia[]>();
  for (const m of movimientos) {
    if (m.tipo !== "cargo" || m.esDebito || m.centavos <= 0) continue;
    const lista = movsPorMonto.get(m.centavos);
    if (lista) lista.push(m);
    else movsPorMonto.set(m.centavos, [m]);
  }

  const resultado = new Map<string, Coincidencia>();
  for (const [monto, movs] of movsPorMonto) {
    const candidatos = (gastosPorMonto.get(monto) ?? []).sort(porFechaHora);
    if (candidatos.length === 0) continue;
    movs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));

    const usados = new Set<string>();
    const asignados = new Map<string, { gasto: GastoCorreo; dif: number }>();
    for (let dif = 0; dif <= TOLERANCIA_DIAS; dif++) {
      for (const mov of movs) {
        if (asignados.has(mov.id)) continue;
        const gasto = candidatos.find(
          (g) => !usados.has(g.id) && Math.abs(diasEntre(g.fecha, mov.fecha)) === dif
        );
        if (!gasto) continue;
        usados.add(gasto.id);
        asignados.set(mov.id, { gasto, dif });
      }
    }

    for (const [id, { gasto, dif }] of asignados) {
      const mov = movs.find((m) => m.id === id)!;
      const otros = candidatos.filter(
        (g) => !usados.has(g.id) && Math.abs(diasEntre(g.fecha, mov.fecha)) <= TOLERANCIA_DIAS
      ).length;
      resultado.set(id, { gasto, diasDeDiferencia: dif, otrosCandidatos: otros });
    }
  }
  return resultado;
}

/** Fecha del aviso de correo más antiguo cargado (antes de ella no hay con qué
 * emparejar), o null si no hay ninguno. */
export function primeraFechaCorreo(gastos: GastoCorreo[]): string | null {
  return gastos.reduce<string | null>((min, g) => (min === null || g.fecha < min ? g.fecha : min), null);
}

/**
 * Eventos que se pueden HEREDAR del correo: movimientos del estado de cuenta SIN evento cuyo
 * aviso emparejado SÍ tiene uno -> `evento -> ids de los movimientos`. Los que ya tienen un
 * evento (el mismo o uno distinto) no se tocan: el emparejamiento es una pista (monto y
 * fecha), y no debe pisar algo que el usuario ya asignó.
 */
export function eventosHeredables(
  movimientos: MovimientoDia[],
  coincidencias: Map<string, Coincidencia>
): Map<string, string[]> {
  const porEvento = new Map<string, string[]>();
  for (const m of movimientos) {
    const evento = coincidencias.get(m.id)?.gasto.evento;
    if (!evento || m.evento) continue;
    const ids = porEvento.get(evento);
    if (ids) ids.push(m.id);
    else porEvento.set(evento, [m.id]);
  }
  return porEvento;
}

/** Una TDC cuyo último movimiento quedó más de estos días antes que el de la TDC más al
 * día se toma como tarjeta que ya no se usa: no frena el corte de `avisosPendientes`. */
export const DIAS_TARJETA_INACTIVA = 90;

export interface AvisosPendientes {
  /** Avisos CON evento que todavía no tienen su cargo en un estado de cuenta: el gasto que
   * ya ocurrió pero aún no llega en un PDF. */
  pendientes: GastoCorreo[];
  /** Avisos con evento cuyo cargo YA llegó, pero sin evento: no se suman aquí (no son
   * pendientes); se arreglan con "Heredar eventos" en Gastos recientes. */
  porHeredar: number;
  /** Avisos con evento sin pareja de días que todas las TDC ya cubren (en o antes de
   * `corte`): casi seguro el cargo sí llegó con otro monto (tipo de cambio, propina), así
   * que NO se suman, para no contarlos dos veces. */
  descartados: number;
  /** Último día que cubren TODOS los estados de cuenta de TDC en uso (null = no hay TDC). */
  corte: string | null;
}

/**
 * Avisos de correo con evento que aún no están en el estado de cuenta (Eventos -> serie
 * "Por correo"). Se usa el mismo emparejamiento uno a uno que "Gastos recientes"
 * (`conciliarConCorreo`, monto exacto y ±1 día) sobre TODAS las transacciones: un aviso
 * emparejado ya está contado por su cargo y no se vuelve a sumar.
 */
export function avisosPendientes(transacciones: Transaccion[], gastos: GastoCorreo[]): AvisosPendientes {
  const movimientos = transacciones.flatMap((t) => aMovimiento(t) ?? []);
  const coincidencias = conciliarConCorreo(movimientos, gastos);
  const emparejados = new Set(Array.from(coincidencias.values(), (c) => c.gasto.id));
  let porHeredar = 0;
  for (const m of movimientos) if (!m.evento && coincidencias.get(m.id)?.gasto.evento) porHeredar += 1;

  const ultimas = ultimaFechaPorCuenta(transacciones).filter((u) => !u.esDebito).map((u) => u.fecha);
  const masReciente = ultimas.reduce<string | null>((max, f) => (max === null || f > max ? f : max), null);
  const corte = masReciente
    ? ultimas
        .filter((f) => diasEntre(masReciente, f) <= DIAS_TARJETA_INACTIVA)
        .reduce((min, f) => (f < min ? f : min), masReciente)
    : null;

  const pendientes: GastoCorreo[] = [];
  let descartados = 0;
  for (const g of gastos) {
    if (!g.evento || emparejados.has(g.id) || centavos(g.monto) <= 0) continue;
    if (g.moneda && g.moneda !== "MXN") continue;
    if (corte && g.fecha <= corte) descartados += 1;
    else pendientes.push(g);
  }
  pendientes.sort((a, b) => -porFechaHora(a, b));
  return { pendientes, porHeredar, descartados, corte };
}

/** Agrega a los puntos por evento (de `agruparPor`) la serie `porCorreo` con los avisos
 * pendientes; un evento que solo tiene avisos (un viaje en curso) entra también. Reordena
 * por ingresos + gastos + por correo, igual que `agruparPor`. */
export function conPendientesPorEvento(puntos: PuntoDimension[], pendientes: GastoCorreo[]): PuntoDimension[] {
  const porEvento = new Map(puntos.map((p) => [p.nombre, { ...p }]));
  for (const g of pendientes) {
    if (!g.evento) continue;
    let punto = porEvento.get(g.evento);
    if (!punto) {
      punto = { nombre: g.evento, ingresos: 0, gastos: 0 };
      porEvento.set(g.evento, punto);
    }
    punto.porCorreo = (punto.porCorreo ?? 0) + g.monto;
  }
  const total = (p: PuntoDimension) => p.ingresos + p.gastos + (p.porCorreo ?? 0);
  return Array.from(porEvento.values()).sort((a, b) => total(b) - total(a));
}

/** El cargo del estado de cuenta emparejado con un aviso (vista "Por correo"). */
export interface CargoEmparejado {
  mov: MovimientoDia;
  /** 0 = el mismo día; 1 = un día antes o después. */
  diasDeDiferencia: number;
}

/** La misma conciliación vista desde el correo: `Map<id del aviso, cargo>`. Como el
 * emparejamiento es uno a uno, cada aviso tiene a lo más un cargo. */
export function cargosPorAviso(
  movimientos: MovimientoDia[],
  coincidencias: Map<string, Coincidencia>
): Map<string, CargoEmparejado> {
  const porId = new Map(movimientos.map((m) => [m.id, m]));
  const resultado = new Map<string, CargoEmparejado>();
  for (const [id, c] of coincidencias) {
    const mov = porId.get(id);
    if (mov) resultado.set(c.gasto.id, { mov, diasDeDiferencia: c.diasDeDiferencia });
  }
  return resultado;
}

/** Último día con movimientos de alguna TDC (null = no hay): un aviso posterior
 * todavía no puede estar en un estado de cuenta. */
export function ultimoDiaTarjetas(transacciones: Transaccion[]): string | null {
  return ultimaFechaPorCuenta(transacciones)
    .filter((u) => !u.esDebito)
    .reduce<string | null>((max, u) => (max === null || u.fecha > max ? u.fecha : max), null);
}

/** Fecha del último CARGO de cada evento: el del estado de cuenta o el de un aviso pendiente
 * por correo, el más reciente. Un evento sin cargos (solo abonos) usa su último movimiento. */
export function ultimoCargoPorEvento(
  transacciones: Transaccion[],
  pendientes: GastoCorreo[]
): Map<string, string> {
  const cargos = new Map<string, string>();
  const cualquiera = new Map<string, string>();
  const anotar = (mapa: Map<string, string>, evento: string, fecha: string) => {
    const actual = mapa.get(evento);
    if (!actual || fecha > actual) mapa.set(evento, fecha);
  };
  for (const t of transacciones) {
    const evento = t.eventos?.nombre;
    if (!evento) continue;
    anotar(cualquiera, evento, t.fecha);
    if (t.tipo === "cargo") anotar(cargos, evento, t.fecha);
  }
  for (const g of pendientes) if (g.evento) anotar(cargos, g.evento, g.fecha);
  for (const [evento, fecha] of cualquiera) if (!cargos.has(evento)) cargos.set(evento, fecha);
  return cargos;
}

/** Del más reciente al más antiguo según `ultimoCargoPorEvento`; empates por nombre. */
export function ordenarPorUltimoCargo(puntos: PuntoDimension[], ultimas: Map<string, string>): PuntoDimension[] {
  return [...puntos].sort(
    (a, b) =>
      (ultimas.get(b.nombre) ?? "").localeCompare(ultimas.get(a.nombre) ?? "") ||
      a.nombre.localeCompare(b.nombre, "es")
  );
}
