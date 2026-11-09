import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { mensajeErrorSalud } from "./salud";

describe("mensajeErrorSalud", () => {
  it("esquema no expuesto = falta la migración", () => {
    expect(mensajeErrorSalud({ code: "PGRST106", message: "x" })).toMatch(/falta aplicar su migración/);
    expect(
      mensajeErrorSalud({ message: "The schema must be one of the following: public, graphql_public" })
    ).toMatch(/falta aplicar su migración/);
  });

  it("cualquier otro error es genérico", () => {
    expect(mensajeErrorSalud({ code: "42501", message: "permission denied" })).toMatch(/Intenta de nuevo/);
    expect(mensajeErrorSalud(null)).toMatch(/Intenta de nuevo/);
  });
});
