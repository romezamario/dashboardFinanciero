import { describe, expect, it } from "vitest";
import { puedeUsarTrading } from "../../functions/api/_middleware";

describe("puedeUsarTrading", () => {
  it("deja pasar al dueño sin importar mayúsculas ni espacios", () => {
    expect(puedeUsarTrading("RomezaMario@gmail.com ")).toBe(true);
  });

  it("bloquea a cualquier otro correo que reporte Access", () => {
    expect(puedeUsarTrading("invitada@gmail.com")).toBe(false);
  });

  it("usa la lista de CORREOS_TRADING cuando existe", () => {
    expect(puedeUsarTrading("otro@gmail.com", "a@b.mx, Otro@gmail.com")).toBe(true);
    expect(puedeUsarTrading("romezamario@gmail.com", "a@b.mx")).toBe(false);
  });

  it("sin encabezado de Access (desarrollo local) no bloquea", () => {
    expect(puedeUsarTrading(null)).toBe(true);
  });
});
