import type { Transaccion } from "../lib/types";

let siguienteId = 0;

/** Transacción de prueba: cargo de $100 en "TDC Beyond" (Banamex TDC) salvo
 * lo que se indique. `cuenta`/`banco` arman el documento anidado. */
export function transaccion(
  parcial: Partial<Omit<Transaccion, "categorias" | "eventos" | "documentos">> & {
    categoria?: string;
    evento?: string;
    cuenta?: string;
    banco?: string;
  } = {}
): Transaccion {
  const { categoria, evento, cuenta = "TDC Beyond", banco = "Banamex TDC", ...campos } = parcial;
  siguienteId += 1;
  return {
    id: `t${siguienteId}`,
    fecha: "2026-08-14",
    descripcion: "COMPRA",
    monto: 100,
    tipo: "cargo",
    saldo: null,
    comercio: null,
    tarjeta: null,
    categorias: categoria ? { nombre: categoria } : null,
    eventos: evento ? { nombre: evento } : null,
    documentos: { id: `doc-${cuenta}`, cuentas: { id: `cta-${cuenta}`, alias: cuenta, bancos: { nombre: banco } } },
    ...campos,
  };
}
