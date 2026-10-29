import { describe, expect, it } from "vitest";
import {
  calcularFibonacci,
  calcularNiveles,
  calcularSerieTecnica,
  indiceEnX,
  medirRango,
  rsi,
  sma,
  type PuntoTecnico,
  type Vela,
} from "./tecnico";

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

describe("medirRango", () => {
  const p = (fecha: string, cierre: number) => ({ fecha, cierre }) as PuntoTecnico;
  const puntos = [p("2026-08-26", 73.32), p("2026-09-10", 70), p("2026-09-29", 78.05)];

  it("mide de cierre a cierre sin importar hacia dónde se arrastra", () => {
    for (const [a, b] of [[0, 2], [2, 0]]) {
      const r = medirRango(puntos, a, b)!;
      expect(r.desde.fecha).toBe("2026-08-26");
      expect(r.hasta.fecha).toBe("2026-09-29");
      expect(r.cambio).toBeCloseTo(4.73, 2);
      expect(r.cambioPct).toBeCloseTo(0.0645, 4);
    }
  });

  it("baja da cambio negativo y fuera de rango da null", () => {
    expect(medirRango(puntos, 0, 1)!.cambio).toBeLessThan(0);
    expect(medirRango(puntos, 0, 9)).toBeNull();
  });
});

describe("indiceEnX", () => {
  it("con velas reparte el ancho en bandas iguales y recorta a los extremos", () => {
    expect(indiceEnX(0, 100, 4, "bandas")).toBe(0);
    expect(indiceEnX(49, 100, 4, "bandas")).toBe(1);
    expect(indiceEnX(99.9, 100, 4, "bandas")).toBe(3);
    expect(indiceEnX(-10, 100, 4, "bandas")).toBe(0);
    expect(indiceEnX(150, 100, 4, "bandas")).toBe(3);
  });

  it("con línea toma el punto más cercano, de borde a borde", () => {
    expect(indiceEnX(0, 90, 4, "puntos")).toBe(0);
    expect(indiceEnX(40, 90, 4, "puntos")).toBe(1);
    expect(indiceEnX(90, 90, 4, "puntos")).toBe(3);
  });
});

describe("calcularFibonacci", () => {
  it("en alza mide los retrocesos desde el máximo hacia abajo", () => {
    const f = calcularFibonacci(velas([101, 105, 120, 151]))!;
    expect(f.tendencia).toBe("alza");
    expect(f.minimo.precio).toBe(100);
    expect(f.maximo.precio).toBe(152);
    expect(f.niveles[0]).toEqual({ proporcion: 0, valor: 152 });
    expect(f.niveles.find((n) => n.proporcion === 0.5)!.valor).toBe(126);
    expect(f.niveles[f.niveles.length - 1].valor).toBe(100);
    expect(f.niveles.find((n) => n.proporcion === 0.618)!.valor).toBeCloseTo(152 - 52 * 0.618);
  });

  it("en baja mide desde el mínimo hacia arriba", () => {
    const f = calcularFibonacci(velas([151, 130, 101]))!;
    expect(f.tendencia).toBe("baja");
    expect(f.niveles[0].valor).toBe(100);
    expect(f.niveles[f.niveles.length - 1].valor).toBe(152);
    expect(f.niveles.find((n) => n.proporcion === 0.382)!.valor).toBeCloseTo(100 + 52 * 0.382);
  });

  it("sin rango no hay retrocesos", () => {
    expect(calcularFibonacci(velas([100]))).toBeNull();
    expect(calcularFibonacci([])).toBeNull();
  });
});
