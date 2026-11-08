import { describe, expect, it } from "vitest";
import { armarEspacios, ESPACIOS, espacioDeHash, hashDeEspacio, type ManifiestoEspacio } from "./espacios";

const vista = () => Promise.resolve({ default: () => null });

describe("armarEspacios", () => {
  it("Finanzas va primero y el resto por orden; sin vista = Próximamente", () => {
    const lista = armarEspacios([
      { id: "viajes", nombre: "Viajes", descripcion: "", orden: 30 },
      { id: "trading", nombre: "Trading", descripcion: "", orden: 10, cargar: vista },
    ]);
    expect(lista.map((e) => e.id)).toEqual(["finanzas", "trading", "viajes"]);
    expect(lista.map((e) => e.disponible)).toEqual([true, true, false]);
  });

  it("descarta ids inválidos o repetidos (incluidos finanzas e inicio)", () => {
    const malos: ManifiestoEspacio[] = [
      { id: "Viajes", nombre: "", descripcion: "", orden: 1 },
      { id: "finanzas", nombre: "", descripcion: "", orden: 1 },
      { id: "inicio", nombre: "", descripcion: "", orden: 1 },
      { id: "a", nombre: "", descripcion: "", orden: 1 },
      { id: "a", nombre: "", descripcion: "", orden: 2 },
    ];
    expect(armarEspacios(malos).map((e) => e.id)).toEqual(["finanzas", "a"]);
  });
});

describe("espacios registrados (src/espacios/*)", () => {
  it("cada carpeta se registra con su id", () => {
    const ids = ESPACIOS.map((e) => e.id);
    for (const id of ["finanzas", "trading", "salud", "viajes"]) expect(ids).toContain(id);
  });
});

describe("espacioDeHash", () => {
  const lista = armarEspacios([
    { id: "trading", nombre: "Trading", descripcion: "", orden: 10, cargar: vista },
    { id: "viajes", nombre: "Viajes", descripcion: "", orden: 30 },
  ]);

  it("sin hash o con uno desconocido es el inicio", () => {
    expect(espacioDeHash("", lista)).toBe("inicio");
    expect(espacioDeHash("#algo", lista)).toBe("inicio");
  });

  it("un espacio con vista se abre; uno 'Próximamente' no", () => {
    expect(espacioDeHash("#trading", lista)).toBe("trading");
    expect(espacioDeHash("#finanzas", lista)).toBe("finanzas");
    expect(espacioDeHash("#viajes", lista)).toBe("inicio");
  });

  it("las anclas de la wiki abren Finanzas", () => {
    expect(espacioDeHash("#wiki-seguridad", lista)).toBe("finanzas");
  });

  it("ida y vuelta con hashDeEspacio", () => {
    expect(hashDeEspacio("inicio")).toBe("");
    expect(espacioDeHash(hashDeEspacio("trading"), lista)).toBe("trading");
  });
});
