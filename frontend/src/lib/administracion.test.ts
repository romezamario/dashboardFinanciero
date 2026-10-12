import { describe, expect, it } from "vitest";
import { filtrarMuestras, textoParaClaude, type Muestra } from "./administracion";

const muestra = (estado: Muestra["estado"], extra: Partial<Muestra> = {}): Muestra => ({
  id: estado,
  creado_en: "2026-10-12T10:00:00Z",
  motivo: "banco-desconocido",
  banco_detectado: null,
  comentario: null,
  paginas: 2,
  estado,
  ...extra,
});

describe("administración de muestras", () => {
  const todas = [muestra("nueva"), muestra("en-revision"), muestra("resuelta"), muestra("descartada")];

  it("pendientes = nuevas y en revisión", () => {
    expect(filtrarMuestras(todas, "pendientes").map((m) => m.estado)).toEqual(["nueva", "en-revision"]);
    expect(filtrarMuestras(todas, "resuelta")).toHaveLength(1);
    expect(filtrarMuestras(todas, "todas")).toHaveLength(4);
  });

  it("el texto para Claude lleva el contexto de la muestra", () => {
    const texto = textoParaClaude(muestra("nueva", { comentario: "BBVA débito", banco_detectado: "Banamex" }), "XXXX 0,000.00");
    expect(texto).toContain("2 página(s)");
    expect(texto).toContain("Comentario del cliente: BBVA débito");
    expect(texto).toContain("Lector que lo reconoció: Banamex");
    expect(texto.endsWith("\n\nXXXX 0,000.00")).toBe(true);
  });
});
