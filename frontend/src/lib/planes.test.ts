import { describe, expect, it } from "vitest";
import { ahorroAnual, PLANES, precioPorMes } from "./planes";

const plan = (id: string) => PLANES.find((p) => p.id === id)!;

describe("planes", () => {
  it("los precios son los decididos (MXN 29/59 al mes, 290/590 al año)", () => {
    expect(plan("basico").precioMensual).toBe(29);
    expect(plan("basico").precioAnual).toBe(290);
    expect(plan("pro").precioMensual).toBe(59);
    expect(plan("pro").precioAnual).toBe(590);
    expect(plan("gratis").precioMensual).toBe(0);
  });

  it("el anual se prorratea por mes y el mensual no cambia", () => {
    expect(precioPorMes(plan("basico"), "anual")).toBeCloseTo(24.17, 2);
    expect(precioPorMes(plan("basico"), "mensual")).toBe(29);
    expect(precioPorMes(plan("gratis"), "anual")).toBe(0);
  });

  it("pagar anual ahorra dos meses", () => {
    expect(ahorroAnual(plan("basico"))).toBe(58);
    expect(ahorroAnual(plan("pro"))).toBe(118);
    expect(ahorroAnual(plan("gratis"))).toBe(0);
  });
});
