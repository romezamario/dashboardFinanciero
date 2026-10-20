import { describe, expect, it } from "vitest";
import { monedaCompacta } from "./formato";

describe("monedaCompacta", () => {
  it("abrevia montos para celdas angostas", () => {
    expect(monedaCompacta.format(733.63)).toBe("$734");
    expect(monedaCompacta.format(219)).toBe("$219");
    expect(monedaCompacta.format(999.4)).toBe("$999");
    expect(monedaCompacta.format(999.6)).toBe("$1k");
    expect(monedaCompacta.format(1109.1)).toBe("$1.1k");
    expect(monedaCompacta.format(2086.82)).toBe("$2.1k");
    expect(monedaCompacta.format(15400)).toBe("$15k");
    expect(monedaCompacta.format(-1500)).toBe("-$1.5k");
  });
});
