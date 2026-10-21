import { describe, expect, it } from "vitest";
import { temaDeInicio } from "./tema";

describe("temaDeInicio", () => {
  it("respeta lo que el usuario eligió", () => {
    expect(temaDeInicio("light", "producto")).toBe("light");
    expect(temaDeInicio("dark", null)).toBe("dark");
  });
  it("Ordena tu Lana abre en oscuro si nunca se eligió", () => {
    expect(temaDeInicio(null, "producto")).toBe("dark");
    expect(temaDeInicio("otra-cosa", "producto")).toBe("dark");
  });
  it("la edición personal sigue al sistema", () => {
    expect(temaDeInicio(null, null)).toBeNull();
  });
});
