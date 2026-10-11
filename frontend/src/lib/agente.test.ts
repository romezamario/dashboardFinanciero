import { describe, expect, it } from "vitest";
import type { SaldoAgente } from "../../functions/api/agente-saldo";
import { resumirSaldo } from "./agente";

function saldo(valores: number[]): SaldoAgente {
  return {
    currency: "MXN",
    source: "paper",
    strategy: "ensemble",
    initial_balance: 10000,
    current_balance: valores[valores.length - 1] ?? 0,
    goal: 100_000_000,
    updated_at: "2026-10-11T00:00:00Z",
    series: valores.map((balance, i) => ({ date: `2025-01-${String(i + 1).padStart(2, "0")}`, balance })),
  };
}

describe("resumirSaldo", () => {
  it("calcula cambio, peor caída y avance a la meta", () => {
    const r = resumirSaldo(saldo([10000, 12000, 9000, 11000]))!;
    expect(r.saldoActual).toBe(11000);
    expect(r.cambio).toBeCloseTo(0.1);
    expect(r.peorCaida).toBeCloseTo(-0.25);
    expect(r.avanceMeta).toBeCloseTo(0.00011);
    expect(r.desde).toBe("2025-01-01");
    expect(r.hasta).toBe("2025-01-04");
  });

  it("sin caídas la peor caída es 0", () => {
    expect(resumirSaldo(saldo([10000, 10500, 11000]))!.peorCaida).toBe(0);
  });

  it("serie vacía no tiene resumen", () => {
    expect(resumirSaldo(saldo([]))).toBeNull();
  });
});
