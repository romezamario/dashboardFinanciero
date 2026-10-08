import { describe, expect, it } from "vitest";
import {
  calcularGastoHormiga,
  categoriasExcluidasPorDefecto,
  ladoDominante,
  rangoDeAnio,
  resolverPeriodo,
  UMBRAL_GASTO_HORMIGA,
} from "./indicadores";
import { transaccion } from "../test/fabrica";

const HOY = new Date(2026, 9, 8); // 8 de octubre de 2026, hora local

describe("resolverPeriodo", () => {
  it("sin filtro: los 3 meses completos anteriores al mes en curso", () => {
    const p = resolverPeriodo({ desde: "", hasta: "" }, HOY);
    expect(p.meses).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(p.anteriores).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(p.porDefecto).toBe(true);
  });

  it("un solo extremo = ese mes; invertidos se ordenan; cruza de año", () => {
    expect(resolverPeriodo({ desde: "2026-03", hasta: "" }, HOY).meses).toEqual(["2026-03"]);
    const p = resolverPeriodo({ desde: "2026-01", hasta: "2025-11" }, HOY);
    expect(p.meses).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(p.anteriores).toEqual(["2025-08", "2025-09", "2025-10"]);
  });
});

describe("rangoDeAnio", () => {
  it("del primer al último mes CON datos de ese año", () => {
    expect(rangoDeAnio("2025", ["2024-12", "2025-03", "2025-09", "2026-01"])).toEqual({
      desde: "2025-03",
      hasta: "2025-09",
    });
  });
});

describe("categoriasExcluidasPorDefecto", () => {
  it("oculta pagos de tarjeta y traspasos entre cuentas propias", () => {
    const ocultas = categoriasExcluidasPorDefecto(["Pago TDC", "Traspaso entre cuentas", "Comida"]);
    expect([...ocultas].sort()).toEqual(["Pago TDC", "Traspaso entre cuentas"]);
  });
});

describe("ladoDominante", () => {
  it("ingreso solo si hay abonos y ningún cargo", () => {
    expect(ladoDominante([transaccion({ tipo: "abono" })])).toBe("ingreso");
    expect(ladoDominante([transaccion({ tipo: "abono" }), transaccion()])).toBe("gasto");
    expect(ladoDominante([])).toBe("gasto");
  });
});

describe("calcularGastoHormiga", () => {
  it(`cuenta cargos de menos de $${UMBRAL_GASTO_HORMIGA} del periodo`, () => {
    const r = calcularGastoHormiga(
      [
        transaccion({ monto: 50, fecha: "2026-08-01" }),
        transaccion({ monto: UMBRAL_GASTO_HORMIGA, fecha: "2026-08-02" }),
        transaccion({ monto: 20, fecha: "2026-07-31" }),
        transaccion({ monto: 30, fecha: "2026-08-03", tipo: "abono" }),
      ],
      ["2026-08"]
    );
    expect(r.cantidad).toBe(1);
    expect(r.total).toBe(50);
    expect(r.proporcion).toBeCloseTo(50 / 250);
  });
});
