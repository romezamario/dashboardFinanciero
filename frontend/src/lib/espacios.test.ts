import { describe, expect, it } from "vitest";
import { ESPACIOS, espacioDeHash, hashDeEspacio } from "./espacios";

describe("espacioDeHash", () => {
  it("sin hash o con uno desconocido es el inicio", () => {
    expect(espacioDeHash("")).toBe("inicio");
    expect(espacioDeHash("#")).toBe("inicio");
    expect(espacioDeHash("#algo")).toBe("inicio");
  });

  it("reconoce cada espacio", () => {
    for (const e of ESPACIOS) expect(espacioDeHash(`#${e.id}`)).toBe(e.id);
  });

  it("las anclas de la wiki abren Finanzas", () => {
    expect(espacioDeHash("#wiki-seguridad")).toBe("finanzas");
  });

  it("ida y vuelta con hashDeEspacio", () => {
    expect(hashDeEspacio("inicio")).toBe("");
    for (const e of ESPACIOS) expect(espacioDeHash(hashDeEspacio(e.id))).toBe(e.id);
  });
});
