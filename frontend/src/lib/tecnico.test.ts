import { describe, expect, it } from "vitest";
import { rsi, sma } from "./tecnico";

describe("sma", () => {
  it("null hasta completar la ventana", () => {
    expect(sma([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });
});

describe("rsi", () => {
  it("100 si solo sube; 0 si solo baja; null antes de n", () => {
    const sube = rsi(Array.from({ length: 20 }, (_, i) => 100 + i), 14);
    expect(sube.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(sube[19]).toBe(100);
    const baja = rsi(Array.from({ length: 20 }, (_, i) => 100 - i), 14);
    expect(baja[19]).toBe(0);
  });
});
