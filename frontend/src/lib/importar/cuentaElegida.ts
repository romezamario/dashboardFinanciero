// La cuenta que el cliente elige al guardar una plantilla de Excel o un
// movimiento capturado a mano (ElegirCuenta en SubirPiezas.tsx).

import type { CuentaExistente, DestinoExcel } from "./guardarExcel";

/** Valor de `ElegirCuenta`: una cuenta existente (`cuentaId`) o, con
 * `cuentaId` vacío, los datos de una nueva. */
export interface CuentaElegida {
  cuentaId: string;
  alias: string;
  ultimos4: string;
  tarjetaCredito: boolean;
}

export const CUENTA_NUEVA: CuentaElegida = { cuentaId: "", alias: "", ultimos4: "", tarjetaCredito: false };

/** Si ya se puede guardar en esa cuenta: una nueva necesita nombre, y los
 * últimos dígitos son 4 o ninguno. */
export const cuentaLista = (c: CuentaElegida) =>
  c.cuentaId !== "" || (c.alias.trim() !== "" && (c.ultimos4 === "" || /^\d{4}$/.test(c.ultimos4)));

export const destinoDe = (c: CuentaElegida): DestinoExcel =>
  c.cuentaId !== ""
    ? { tipo: "existente", cuentaId: c.cuentaId }
    : { tipo: "nueva", alias: c.alias, ultimos4: c.ultimos4 || null, tarjetaCredito: c.tarjetaCredito };

export const nombreDeCuenta = (c: CuentaElegida, cuentas: readonly CuentaExistente[]) =>
  c.cuentaId === "" ? c.alias.trim() : (cuentas.find((x) => x.id === c.cuentaId)?.alias ?? "");

