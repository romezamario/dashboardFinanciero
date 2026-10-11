// Pestaña "Agente de trading": el saldo de la cuenta simulada del agente
// (repo aparte, romezamario/trading-agent). Aquí solo se lee y se resume;
// el agente decide y calcula todo en su propio repo.
import type { SaldoAgente } from "../../functions/api/agente-saldo";

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

/** Trae el saldo de /api/agente-saldo (Pages Function). El error viene con
 * un mensaje en español listo para mostrarse. */
export async function obtenerSaldoAgente(): Promise<SaldoAgente> {
  const respuesta = await fetch("/api/agente-saldo");
  const cuerpo = (await respuesta.json().catch(() => ({}))) as SaldoAgente & { error?: string };
  if (!respuesta.ok) throw new Error(cuerpo.error ?? `El servidor respondió ${respuesta.status}`);
  return cuerpo;
}
