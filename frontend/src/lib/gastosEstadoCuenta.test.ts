import { describe, expect, it } from "vitest";
import { agruparEstadosPorDia } from "./gastosEstadoCuenta";
import { esTarjetaCredito } from "./tarjetas";
import { transaccion } from "../test/fabrica";

describe("esTarjetaCredito", () => {
  it("por banco o alias con 'TDC'; la cuenta de cheques no", () => {
    expect(esTarjetaCredito(transaccion({ cuenta: "Invex TDC", banco: "Invex TDC" }))).toBe(true);
    expect(esTarjetaCredito(transaccion({ cuenta: "Priority", banco: "Banamex" }))).toBe(false);
  });
});

describe("agruparEstadosPorDia", () => {
  it("solo suman los cargos de TDC de categorías no ocultas", () => {
    const [dia] = agruparEstadosPorDia(
      [
        transaccion({ monto: 100, categoria: "Comida" }),
        transaccion({ monto: 40, tipo: "abono", categoria: "Devolución" }),
        transaccion({ monto: 500, categoria: "Pago TDC" }),
        transaccion({ monto: 70, cuenta: "Priority", banco: "Banamex", categoria: "Comida" }),
        transaccion({ monto: 0, categoria: "Comida" }),
      ],
      new Set(["Pago TDC"])
    );
    expect(dia.total.total).toBe(10000);
    expect(dia.gastos).toHaveLength(1);
    expect(dia.sinSumar.map((s) => s.motivo).sort()).toEqual([
      "Categoría oculta",
      "Cuenta de cheques",
      "Es un abono",
    ]);
    expect(dia.cuentasDebito).toEqual(["Priority"]);
  });

  it("los cargos de un evento oculto no suman y quedan en el detalle con su motivo", () => {
    const movimientos = [
      transaccion({ monto: 100, categoria: "Comida" }),
      transaccion({ monto: 900, categoria: "Hospedaje", evento: "Viaje" }),
      transaccion({ monto: 50, tipo: "abono", categoria: "Devolución", evento: "Viaje" }),
    ];
    const [conViaje] = agruparEstadosPorDia(movimientos, new Set());
    expect(conViaje.total.total).toBe(100_000);
    expect(conViaje.hayAbonos).toBe(true);

    const [sinViaje] = agruparEstadosPorDia(movimientos, new Set(), new Set(["Viaje"]));
    expect(sinViaje.total.total).toBe(10000);
    expect(sinViaje.sinSumar.map((s) => s.motivo).sort()).toEqual(["Es un abono", "Evento oculto"]);
    // Una devolución de un evento oculto tampoco marca el día como "con abonos".
    expect(sinViaje.hayAbonos).toBe(false);
  });

  it("del día más reciente al más antiguo", () => {
    const dias = agruparEstadosPorDia(
      [transaccion({ fecha: "2026-08-01" }), transaccion({ fecha: "2026-08-03" })],
      new Set()
    );
    expect(dias.map((d) => d.fecha)).toEqual(["2026-08-03", "2026-08-01"]);
  });
});
