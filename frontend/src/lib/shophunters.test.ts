import { describe, expect, it } from "vitest";
import { esEventoShophunters, soloShophunters } from "./shophunters";
import { transaccion } from "../test/fabrica";

describe("esEventoShophunters", () => {
  it("reconoce el nombre sin importar mayúsculas ni el prefijo del mes", () => {
    expect(esEventoShophunters("2026-08 Shophunters")).toBe(true);
    expect(esEventoShophunters("2026-09 Shophunters")).toBe(true);
    expect(esEventoShophunters("2026-10 SHOPHUNTERS")).toBe(true);
    expect(esEventoShophunters("Shophunters")).toBe(true);
  });
  it("no confunde otros eventos ni la ausencia de evento", () => {
    expect(esEventoShophunters("2026 F1 Mexico")).toBe(false);
    expect(esEventoShophunters("2026-11 Italia")).toBe(false);
    expect(esEventoShophunters(null)).toBe(false);
  });
});

describe("soloShophunters", () => {
  it("deja únicamente los movimientos de eventos de Shophunters", () => {
    const a = transaccion({ evento: "2026-08 Shophunters" });
    const b = transaccion({ evento: "2026-09 Shophunters" });
    const resto = [transaccion({ evento: "2026 Madrid" }), transaccion()];
    expect(soloShophunters([a, ...resto, b])).toEqual([a, b]);
  });
});
