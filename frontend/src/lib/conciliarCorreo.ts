import type { GastoCorreo } from "./gastosCorreo";
import { diasEntre, type MovimientoDia } from "./gastosEstadoCuenta";

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
