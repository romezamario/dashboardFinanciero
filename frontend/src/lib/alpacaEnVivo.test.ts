import { describe, expect, it } from "vitest";
import { armarCuentaAlpaca } from "../../functions/api/alpaca-en-vivo";
import { PARAMETROS_RANGO, esRangoAlpaca, puntosDeHistorial } from "../../functions/api/alpaca-historial";
import { historialGuardadoComoPuntos } from "./agente";

describe("armarCuentaAlpaca", () => {
  const ahora = new Date("2026-10-12T15:30:00.123Z");

  it("convierte los textos de Alpaca al formato de alpaca.json", () => {
    const c = armarCuentaAlpaca(
      { equity: "100250.5", last_equity: "100000", cash: "40000", currency: "USD" },
      [
        { symbol: "BTCUSD", asset_class: "crypto", qty: "0.1", market_value: "6000", unrealized_pl: "-10", unrealized_plpc: "-0.0016" },
        { symbol: "QQQ", asset_class: "us_equity", qty: "20", market_value: "12000", unrealized_pl: "50" },
      ],
      [{ symbol: "QQQ", side: "buy", notional: "12000", qty: null, filled_qty: "20", filled_avg_price: "600", status: "filled", submitted_at: "2026-10-12T13:30:00Z", filled_at: "" }],
      { timestamp: [1760054400, 1760140800, 1760227200], equity: [0, 99900, 100000] },
      ahora
    );
    expect(c.actualizado).toBe("2026-10-12T15:30:00Z");
    expect(c.equity).toBe(100250.5);
    expect(c.last_equity).toBe(100000);
    // Ordenadas por valor, la más grande primero.
    expect(c.posiciones.map((p) => p.symbol)).toEqual(["QQQ", "BTCUSD"]);
    expect(c.posiciones[1].unrealized_plpc).toBe(-0.0016);
    expect(c.posiciones[0].avg_entry_price).toBeNull();
    expect(c.ordenes[0]).toMatchObject({ side: "buy", notional: 12000, qty: null, filled_qty: 20, filled_at: null });
    // El 0 de antes de abrir la cuenta no entra; hoy se agrega con el valor actual.
    expect(c.historial).toEqual([
      { date: "2025-10-11", equity: 99900 },
      { date: "2025-10-12", equity: 100000 },
      { date: "2026-10-12", equity: 100250.5 },
    ]);
  });

  it("aguanta un historial vacío", () => {
    const c = armarCuentaAlpaca({ equity: "1" }, [], [], {}, ahora);
    expect(c.moneda).toBe("USD");
    expect(c.historial).toEqual([{ date: "2026-10-12", equity: 1 }]);
  });
});

describe("historial de Alpaca por rango", () => {
  it("quita ceros y nulos, ordena y pasa a milisegundos", () => {
    expect(puntosDeHistorial({ timestamp: [300, 100, 200, 400], equity: [100010.555, 0, 100000, null] })).toEqual([
      { t: 200000, valor: 100000 },
      { t: 300000, valor: 100010.56 },
    ]);
    expect(puntosDeHistorial({})).toEqual([]);
  });

  it("1D pide puntos de 5 minutos las 24 horas", () => {
    expect(PARAMETROS_RANGO["1D"]).toContain("timeframe=5Min");
    expect(PARAMETROS_RANGO["1D"]).toContain("intraday_reporting=continuous");
    expect(esRangoAlpaca("1M")).toBe(true);
    expect(esRangoAlpaca("5Y")).toBe(false);
    expect(esRangoAlpaca(null)).toBe(false);
  });

  it("el historial guardado cae en su fecha local", () => {
    const [p] = historialGuardadoComoPuntos([{ date: "2026-10-11", equity: 5 }]);
    const d = new Date(p.t);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), p.valor]).toEqual([2026, 10, 11, 5]);
  });
});
