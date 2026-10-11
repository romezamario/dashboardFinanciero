import { describe, expect, it } from "vitest";
import type { CuentaAlpaca, OrdenAgente, PosicionAgente, SaldoAgente } from "../../functions/api/agente-saldo";
import {
  estadoOrdenAlpaca,
  fraccionEnEfectivo,
  nombreSimboloAlpaca,
  ordenesRecientesPrimero,
  resumirAlpaca,
  resumirGanancias,
  resumirSaldo,
} from "./agente";

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

describe("posiciones y órdenes", () => {
  const posicion = (weight: number): PosicionAgente => ({
    asset: "btc", weight, value_mxn: 0, entry_date: null, entry_price_usd: null, price_usd: 1, price_change: null,
  });
  const orden = (date: string, asset: string): OrdenAgente => ({
    date, asset, side: "buy", amount_mxn: 1, price_usd: 1, weight_before: 0, weight_after: 0.1, cost_mxn: 0,
  });

  it("el efectivo es lo que no suman las posiciones", () => {
    expect(fraccionEnEfectivo([posicion(0.3), posicion(0.2)])).toBeCloseTo(0.5);
    expect(fraccionEnEfectivo([])).toBe(1);
  });

  it("ordena las órdenes de la más reciente a la más vieja, conservando el orden del mismo día", () => {
    const ordenadas = ordenesRecientesPrimero([orden("2025-01-01", "a"), orden("2025-01-03", "b"), orden("2025-01-03", "c")]);
    expect(ordenadas.map((o) => o.asset)).toEqual(["c", "b", "a"]);
  });
});

describe("resumirGanancias", () => {
  it("separa realizada, no realizada y el resto (tipo de cambio)", () => {
    const base = saldo([10000, 9500]);
    const r = resumirGanancias({
      ...base,
      trades: [
        { date: "2025-01-01", asset: "btc", side: "buy", amount_mxn: 1000, price_usd: 1, weight_before: 0, weight_after: 0.1, cost_mxn: 6 },
        { date: "2025-01-02", asset: "btc", side: "sell", amount_mxn: 900, price_usd: 1, weight_before: 0.1, weight_after: 0, cost_mxn: 5, pnl_mxn: -111, pnl_pct: -0.11 },
      ],
      positions: [
        { asset: "eth", weight: 0.2, value_mxn: 1900, entry_date: null, entry_price_usd: null, price_usd: 1, price_change: null, cost_basis_mxn: 2200, unrealized_pnl_mxn: -300, unrealized_pnl_pct: -0.136 },
      ],
    })!;
    expect(r.realizada).toBe(-111);
    expect(r.noRealizada).toBe(-300);
    expect(r.tipoDeCambio).toBe(-89);
  });

  it("sin ganancias exportadas no inventa nada", () => {
    expect(resumirGanancias(saldo([10000, 9500]))).toBeNull();
  });
});

describe("cuenta de Alpaca", () => {
  const cuenta: CuentaAlpaca = {
    broker: "alpaca-paper",
    actualizado: "2026-10-11T22:53:42Z",
    moneda: "USD",
    equity: 101000,
    last_equity: 100000,
    cash: 15000,
    posiciones: [
      { symbol: "BTCUSD", asset_class: "crypto", qty: 0.05, avg_entry_price: 1, current_price: 1,
        market_value: 5050, cost_basis: 5000, unrealized_pl: 50, unrealized_plpc: 0.01 },
      { symbol: "QQQ", asset_class: "us_equity", qty: 20, avg_entry_price: 1, current_price: 1,
        market_value: 12000, cost_basis: 12100, unrealized_pl: -100, unrealized_plpc: null },
    ],
    ordenes: [],
  };

  it("resume valor, cambio del día y ganancia no realizada", () => {
    const r = resumirAlpaca(cuenta);
    expect(r.cambioDia).toBe(1000);
    expect(r.cambioDiaPct).toBeCloseTo(0.01);
    expect(r.noRealizada).toBe(-50);
  });

  it("sin cierre anterior no inventa el cambio del día", () => {
    expect(resumirAlpaca({ ...cuenta, last_equity: null }).cambioDia).toBeNull();
  });

  it("nombra símbolos y estados en español", () => {
    expect(nombreSimboloAlpaca("BTCUSD")).toBe("BTC");
    expect(nombreSimboloAlpaca("ETH/USD")).toBe("ETH");
    expect(nombreSimboloAlpaca("QQQ")).toBe("QQQ");
    expect(estadoOrdenAlpaca("filled")).toBe("Ejecutada");
    expect(estadoOrdenAlpaca("algo_nuevo")).toBe("algo_nuevo");
  });
});
