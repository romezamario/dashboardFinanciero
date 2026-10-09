import { describe, expect, it } from "vitest";
import { serieSintetica } from "../../test/series";
import { CONFIG_DETECCION } from "./config";
import { calcularNiveles } from "./niveles";

/** Rango 100–108 con cuatro pisos y tres techos, y luego sale hacia arriba. */
const conRango = () =>
  serieSintetica(104, [
    { hasta: 100, barras: 8 },
    { hasta: 108, barras: 8 },
    { hasta: 100, barras: 8 },
    { hasta: 108, barras: 8 },
    { hasta: 100, barras: 8 },
    { hasta: 108, barras: 8 },
    { hasta: 100, barras: 8 },
    { hasta: 112, barras: 8 },
  ]);

describe("calcularNiveles (con trazabilidad)", () => {
  it("el piso del rango lateral es el soporte estructural y cita sus pivotes", () => {
    const serie = conRango();
    const niveles = calcularNiveles(serie);
    const estructural = niveles.find((n) => n.nombre === "Soporte estructural");
    expect(estructural).toBeDefined();
    expect(estructural!.valor).toBeCloseTo(99.8, 0);
    expect(estructural!.motivo).toContain("Piso del rango lateral");
    expect(estructural!.toques).toBeGreaterThanOrEqual(3);
    // Cada pivote que lo sostiene es una vela real de la serie, con su fecha.
    const porFecha = new Map(serie.map((p) => [p.fecha, p]));
    for (const pivote of estructural!.pivotes) {
      expect(pivote.tipo).toBe("minimo");
      expect(porFecha.get(pivote.fecha)?.minimo).toBe(pivote.precio);
      expect(pivote.vela.fecha).toBe(pivote.fecha);
    }
    expect(estructural!.velasOrigen.map((v) => v.fecha)).toEqual(
      [...new Set(estructural!.pivotes.map((p) => p.fecha))].sort()
    );
  });

  it("con el precio en máximos la resistencia es el máximo de la ventana y lo dice", () => {
    const niveles = calcularNiveles(conRango());
    const resistencia = niveles.find((n) => n.tipo === "resistencia" && n.origen === "maximo");
    expect(resistencia).toBeDefined();
    expect(resistencia!.velasOrigen).toHaveLength(1);
    expect(resistencia!.motivo).toContain("máximo");
  });

  it("la media móvil lleva la última vela como origen y su distancia en el motivo", () => {
    const serie = conRango();
    const sma50 = calcularNiveles(serie).find((n) => n.origen === "sma50");
    expect(sma50).toBeDefined();
    expect(sma50!.velasOrigen.map((v) => v.fecha)).toContain(serie[serie.length - 1].fecha);
    expect(sma50!.motivo).toMatch(/SMA 50 \(\d+\.\d+\) a \d+\.\d% del cierre/);
  });

  it("los parámetros se leen de la configuración: la ventana de pivotes cambia los toques", () => {
    const serie = conRango();
    const normal = calcularNiveles(serie).filter((n) => n.origen === "pivotes");
    const fina = calcularNiveles(serie, {
      ...CONFIG_DETECCION,
      pivotes: { ventana: 2 },
    }).filter((n) => n.origen === "pivotes");
    const toques = (ns: typeof normal) => ns.reduce((a, n) => a + n.toques, 0);
    expect(toques(fina)).toBeGreaterThanOrEqual(toques(normal));
    expect(fina.length + normal.length).toBeGreaterThan(0);
  });

  it("sin historia suficiente no inventa niveles", () => {
    expect(calcularNiveles(serieSintetica(100, [{ hasta: 101, barras: 8 }]))).toEqual([]);
  });
});
