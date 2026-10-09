import { describe, expect, it } from "vitest";
import { calcularNiveles, calcularSerieTecnica, rsi, sma, type Vela } from "./tecnico";

/** Velas sintéticas a partir de cierres: máximo/mínimo = cierre ± 1. */
function velas(cierres: number[]): Vela[] {
  return cierres.map((c, i) => ({
    fecha: `2026-01-${String(i + 1).padStart(3, "0")}`,
    apertura: c,
    maximo: c + 1,
    minimo: c - 1,
    cierre: c,
    volumen: 1000,
  }));
}

/** Oscila entre un piso y un techo (rebota varias veces en ambos). */
function rango(piso: number, techo: number, ciclos: number, paso = 2): number[] {
  const subida: number[] = [];
  for (let v = piso; v < techo; v += paso) subida.push(v);
  const bajada = [...subida].reverse().slice(0, -1).map((v) => v + paso);
  return Array.from({ length: ciclos }, () => [...subida, ...bajada]).flat();
}

describe("calcularNiveles", () => {
  it("resistencia en el techo y soporte en el piso del rango", () => {
    // 6 ciclos 100↔120 y termina a la mitad, en 110.
    const cierres = [...rango(100, 120, 6), 102, 104, 106, 108, 110];
    const niveles = calcularNiveles(calcularSerieTecnica(velas(cierres)));
    const resistencia = niveles.find((n) => n.nombre === "Resistencia");
    const soporte = niveles.find((n) => n.nombre === "Soporte inmediato");
    expect(resistencia!.valor).toBeGreaterThan(118);
    expect(resistencia!.toques).toBeGreaterThanOrEqual(3);
    expect(soporte!.valor).toBeLessThan(102);
    expect(soporte!.toques).toBeGreaterThanOrEqual(3);
    // Ordenados de arriba a abajo.
    expect(niveles.map((n) => n.valor)).toEqual([...niveles.map((n) => n.valor)].sort((a, b) => b - a));
  });

  it("en máximos no hay zona arriba: la resistencia es el máximo de 6 meses", () => {
    const cierres = Array.from({ length: 150 }, (_, i) => 100 + i);
    const niveles = calcularNiveles(calcularSerieTecnica(velas(cierres)));
    const resistencia = niveles.find((n) => n.tipo === "resistencia" && n.origen === "maximo");
    expect(resistencia!.valor).toBe(250); // último cierre 249 + 1
  });

  it("las medias móviles aparecen como soporte cuando están debajo del precio", () => {
    const cierres = Array.from({ length: 260 }, (_, i) => 100 + i * 0.5);
    const nombres = calcularNiveles(calcularSerieTecnica(velas(cierres))).map((n) => n.nombre);
    expect(nombres).toContain("Soporte mayor · SMA 50");
    expect(nombres).toContain("Soporte largo plazo · SMA 200");
  });

  it("sin historia suficiente no inventa niveles", () => {
    expect(calcularNiveles(calcularSerieTecnica(velas([1, 2, 3])))).toEqual([]);
  });
});

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
