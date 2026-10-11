import { describe, expect, it } from "vitest";
import { normalizar, SECCIONES, textoDe } from "./contenido";

describe("wiki", () => {
  it("cada sección tiene un id único", () => {
    const ids = SECCIONES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("el buscador ve el texto de párrafos, tablas y notas", () => {
    const texto = (id: string) => normalizar(textoDe(SECCIONES.find((s) => s.id === id)!.cuerpo));
    expect(texto("resumen-indicadores")).toContain("hormiga");
    expect(texto("constantes")).toContain("umbral_gasto_hormiga"); // celda de tabla
    expect(texto("sincronizacion")).toContain("nunca se borran"); // título de una Nota
    expect(texto("resumen-controles")).toContain("periodo"); // sin acentos
  });
});
