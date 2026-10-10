import { describe, expect, it } from "vitest";
import { promediosDeGastos, promediosDesdeElPrimerGasto } from "./promedios";
import { hoyIso, mesActual } from "./fechas";

const serie = (valores: number[], desde = 2026) =>
  valores.map((gastos, i) => ({ periodo: `${desde}-${String(i + 1).padStart(2, "0")}`, gastos }));

describe("promediosDeGastos", () => {
  it("promedio móvil de 3 meses, null hasta tener 3 meses completos", () => {
    const r = promediosDeGastos(serie([100, 200, 300, 400]), "2026-12");
    expect(r.movil).toEqual([null, null, 200, 300]);
    expect(r.ultimoMovil).toBe(300);
  });

  it("promedios planos de los últimos 3 y 12 meses", () => {
    const valores = Array.from({ length: 12 }, (_, i) => (i + 1) * 100); // 100..1200
    const r = promediosDeGastos(serie(valores), "2027-01");
    expect(r.ultimos3).toBe(1100); // (1000+1100+1200)/3
    expect(r.ultimos12).toBe(650);
  });

  it("con menos de 12 meses promedia los que haya", () => {
    const r = promediosDeGastos(serie([100, 300]), "2026-12");
    expect(r.ultimos12).toBe(200);
    expect(r.ultimos3).toBe(200);
  });

  it("el mes en curso no entra a ningún promedio y no tiene promedio móvil", () => {
    // Octubre es el mes en curso: 150 (a medias) no debe bajar el promedio.
    const puntos = [
      { periodo: "2026-07", gastos: 300 },
      { periodo: "2026-08", gastos: 300 },
      { periodo: "2026-09", gastos: 300 },
      { periodo: "2026-10", gastos: 150 },
    ];
    const r = promediosDeGastos(puntos, "2026-10");
    expect(r.ultimos3).toBe(300);
    expect(r.ultimos12).toBe(300);
    expect(r.movil).toEqual([null, null, 300, null]);
  });

  it("los meses anteriores al primer gasto no cuentan (no son meses de gasto cero)", () => {
    // Un evento que empezó en agosto: de oct a jul no había nada.
    const puntos = [
      ...Array.from({ length: 10 }, (_, i) => ({ periodo: `2025-${String(i + 1).padStart(2, "0")}`, gastos: 0 })),
      { periodo: "2026-08", gastos: 300 },
      { periodo: "2026-09", gastos: 500 },
      { periodo: "2026-10", gastos: 100 },
    ];
    const r = promediosDeGastos(puntos, "2026-10");
    expect(r.ultimos12).toBe(400);
    expect(r.ultimos3).toBe(400);
    // Con solo 2 meses de gasto aún no hay promedio móvil de 3 meses (ni en los meses vacíos).
    expect(r.movil.every((v) => v === null)).toBe(true);
    expect(r.ultimoMovil).toBeNull();
  });

  it("el promedio móvil arranca cuando hay 3 meses completos desde el primer gasto", () => {
    const puntos = [
      { periodo: "2026-05", gastos: 0 },
      { periodo: "2026-06", gastos: 100 },
      { periodo: "2026-07", gastos: 200 },
      { periodo: "2026-08", gastos: 300 },
      { periodo: "2026-09", gastos: 400 },
    ];
    const r = promediosDeGastos(puntos, "2026-10");
    expect(r.movil).toEqual([null, null, null, 200, 300]);
  });

  it("sin meses completos no hay promedios", () => {
    const r = promediosDeGastos([{ periodo: "2026-10", gastos: 100 }], "2026-10");
    expect(r.ultimos3).toBeNull();
    expect(r.ultimos12).toBeNull();
    expect(r.ultimoMovil).toBeNull();
    expect(promediosDeGastos([], "2026-10").movil).toEqual([]);
  });
});

describe("promediosDesdeElPrimerGasto", () => {
  it("ignora los meses anteriores al primer gasto, pero no los $0 que vienen después", () => {
    // 4 meses vacíos, luego 300, un mes sin gasto de verdad (0) y 600.
    const r = promediosDesdeElPrimerGasto([0, 0, 0, 0, 300, 0, 600]);
    expect(r.ultimos12).toBe(300); // (300 + 0 + 600) / 3, no / 7
    expect(r.ultimos3).toBe(300);
    expect(r.movil).toEqual([null, null, null, null, null, null, 300]);
    expect(r.ultimoMovil).toBe(300);
  });

  it("sin ningún gasto no hay promedios", () => {
    const r = promediosDesdeElPrimerGasto([0, 0, 0]);
    expect(r.ultimos3).toBeNull();
    expect(r.ultimos12).toBeNull();
    expect(r.movil).toEqual([null, null, null]);
    expect(promediosDesdeElPrimerGasto([]).ultimoMovil).toBeNull();
  });

  it("con 12 meses de historia completa promedia los últimos 12 y 3 (como antes)", () => {
    const montos = Array.from({ length: 12 }, (_, i) => (i + 1) * 100);
    const r = promediosDesdeElPrimerGasto(montos);
    expect(r.ultimos12).toBe(650);
    expect(r.ultimos3).toBe(1100);
    expect(r.movil[1]).toBeNull();
    expect(r.movil[2]).toBe(200);
  });
});

describe("mesActual", () => {
  it("YYYY-MM en la zona local", () => {
    expect(mesActual(new Date(2026, 9, 9))).toBe("2026-10");
    expect(mesActual(new Date(2026, 0, 31, 23, 30))).toBe("2026-01");
    expect(hoyIso(new Date(2026, 0, 31, 23, 30))).toBe("2026-01-31");
  });
});
