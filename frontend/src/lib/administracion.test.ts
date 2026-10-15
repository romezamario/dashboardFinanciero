import { describe, expect, it } from "vitest";
import {
  estadoPorResultado,
  filtrarMuestras,
  normalizarClaveCambio,
  prepararResolucion,
  textoParaClaude,
  type Muestra,
} from "./administracion";

const muestra = (estado: Muestra["estado"], extra: Partial<Muestra> = {}): Muestra => ({
  id: estado,
  creado_en: "2026-10-12T10:00:00Z",
  motivo: "banco-desconocido",
  banco_detectado: null,
  comentario: null,
  paginas: 2,
  estado,
  user_id: "u1",
  resultado: null,
  clave_cambio: null,
  banco_lector: null,
  recompensa: false,
  mensaje_cliente: null,
  revisada_en: null,
  confirmada_en: null,
  muestra_origen_id: null,
  movimientos_leidos: null,
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

  it("el texto para Claude dice cuántos movimientos sí se leyeron y si es retroalimentación", () => {
    const texto = textoParaClaude(muestra("nueva", { movimientos_leidos: 42, muestra_origen_id: "x" }), "X");
    expect(texto).toContain("sí leyó 42 movimientos");
    expect(texto).toContain("Es retroalimentación");
  });

  it("el resultado decide el estado", () => {
    expect(estadoPorResultado("lector-nuevo")).toBe("lista-para-probar");
    expect(estadoPorResultado("repetida")).toBe("lista-para-probar");
    expect(estadoPorResultado("ya-se-leia")).toBe("descartada");
    expect(estadoPorResultado("no-sirve")).toBe("descartada");
  });

  it("la clave del cambio se normaliza", () => {
    expect(normalizarClaveCambio("  BBVA Débito 2026 ")).toBe("bbva-debito-2026");
  });

  it("un lector nuevo necesita clave; los descartes nunca dan recompensa", () => {
    const base = { banco_lector: " BBVA ", mensaje_cliente: "", recompensa: true };
    expect(prepararResolucion({ ...base, resultado: "lector-nuevo", clave_cambio: "" })).toHaveProperty("error");
    const ok = prepararResolucion({ ...base, resultado: "lector-nuevo", clave_cambio: "BBVA débito" });
    expect(ok).toMatchObject({
      cambios: { estado: "lista-para-probar", clave_cambio: "bbva-debito", banco_lector: "BBVA", recompensa: true, mensaje_cliente: null },
    });
    const descarte = prepararResolucion({ ...base, resultado: "ya-se-leia", clave_cambio: null });
    expect(descarte).toMatchObject({ cambios: { estado: "descartada", recompensa: false } });
  });
});
