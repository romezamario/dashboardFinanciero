import { eventoDe } from "./queries";
import type { Transaccion } from "./types";

// Pestaña "Shophunters": lo mismo que el Resumen pero solo con los movimientos
// de los eventos de Shophunters ("2026-08 Shophunters", "2026-09 Shophunters"...).
// Se reconoce por el NOMBRE del evento (sin importar mayúsculas ni el prefijo
// del mes), así un evento nuevo ("2026-10 Shophunters") entra solo.

const PATRON_SHOPHUNTERS = /shophunters/i;

export function esEventoShophunters(nombre: string | null): boolean {
  return nombre !== null && PATRON_SHOPHUNTERS.test(nombre);
}

/** Solo las transacciones asignadas a un evento de Shophunters. */
export function soloShophunters(transacciones: Transaccion[]): Transaccion[] {
  return transacciones.filter((t) => esEventoShophunters(eventoDe(t)));
}
