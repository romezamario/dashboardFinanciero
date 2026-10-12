import { describe, expect, it } from "vitest";
import { categorizar, REGLAS_BASE } from "./reglasBase";

describe("reglas base de categorización", () => {
  it("ninguna regla queda tapada por una anterior más genérica", () => {
    const tapadas: string[] = [];
    REGLAS_BASE.forEach((regla, j) => {
      const patron = regla.patron.toUpperCase();
      const antes = REGLAS_BASE.slice(0, j).find((otra) => patron.includes(otra.patron.toUpperCase()));
      if (antes) tapadas.push(`"${regla.patron}" nunca gana: "${antes.patron}" va antes`);
    });
    expect(tapadas).toEqual([]);
  });

  it("no repite patrones y todo trae categoría", () => {
    const patrones = REGLAS_BASE.map((r) => r.patron.toUpperCase());
    expect(new Set(patrones).size).toBe(patrones.length);
    expect(REGLAS_BASE.every((r) => r.categoria.trim().length > 0)).toBe(true);
  });

  it("lo específico gana y no distingue mayúsculas", () => {
    const de = (d: string) => {
      const regla = categorizar(d);
      return regla && [regla.categoria, regla.comercio];
    };
    expect(de("OXXO GAS SUC 123")).toEqual(["Transporte", "Gasolinera"]);
    expect(de("Oxxo Lomas")).toEqual(["Supermercado", "Oxxo"]);
    expect(de("UBER EATS PENDING")).toEqual(["Restaurantes", "Uber Eats"]);
    expect(de("UBER *TRIP")).toEqual(["Transporte", "Uber"]);
    expect(de("PAGO TDC BEYOND")).toEqual(["Pago TDC", "Pago TDC"]);
    expect(de("SU PAGO INTERBANCARIO RENTA")).toEqual(["Transferencia recibida", "Transferencia recibida"]);
    expect(de("DOMINOS PIZZA")).toEqual(["Restaurantes", "Domino's Pizza"]);
    expect(de("TIENDA DESCONOCIDA")).toBeNull();
  });
});
