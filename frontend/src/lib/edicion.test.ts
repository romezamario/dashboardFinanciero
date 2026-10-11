import { describe, expect, it } from "vitest";
import { edicionDe, incluyeFuncion, nombreApp } from "./edicion";

describe("edicion", () => {
  it("sin variable o con un valor desconocido es la edición personal", () => {
    expect(edicionDe(undefined)).toBe("personal");
    expect(edicionDe("")).toBe("personal");
    expect(edicionDe("Producto")).toBe("personal");
    expect(edicionDe("producto")).toBe("producto");
  });

  it("la edición personal incluye todo", () => {
    expect(incluyeFuncion("personal", "tecnico")).toBe(true);
    expect(incluyeFuncion("personal", "shophunters")).toBe(true);
    expect(incluyeFuncion("personal", "wiki")).toBe(true);
    expect(incluyeFuncion("personal", "agente")).toBe(true);
  });

  it("el producto no incluye QQQ/Macro, Shophunters ni la Wiki", () => {
    expect(incluyeFuncion("producto", "tecnico")).toBe(false);
    expect(incluyeFuncion("producto", "shophunters")).toBe(false);
    expect(incluyeFuncion("producto", "wiki")).toBe(false);
    expect(incluyeFuncion("producto", "agente")).toBe(false);
  });

  it("nombre de la app por edición", () => {
    expect(nombreApp("personal")).toBe("Dashboard Financiero");
    expect(nombreApp("producto")).toBe("Ordena tu Lana");
  });
});
