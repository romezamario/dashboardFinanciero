import { describe, expect, it } from "vitest";
import { lineaLibre, validarManual, type CamposManual } from "./manual";

const campos = (cambios: Partial<CamposManual> = {}): CamposManual => ({
  fecha: "2026-10-13",
  descripcion: "  Tacos   el güero ",
  monto: "$1,250.5",
  tipo: "cargo",
  categoria: "",
  comercio: "",
  ...cambios,
});

const HOY = "2026-10-14";

describe("validarManual", () => {
  it("arma el movimiento con monto sin signo y la línea de captura manual", () => {
    const { movimiento } = validarManual(campos(), HOY);
    expect(movimiento).toEqual({
      fecha: "2026-10-13",
      descripcion: "Tacos el güero",
      monto: "1250.50",
      tipo: "cargo",
      pagina: 0,
      linea_cruda: "(manual) 2026-10-13 | Tacos el güero | 1250.50 | cargo",
      tarjeta: null,
      categoria: null,
      comercio: null,
    });
  });

  it("un monto negativo no cambia el tipo elegido", () => {
    expect(validarManual(campos({ monto: "-45", tipo: "abono" }), HOY).movimiento).toMatchObject({
      monto: "45.00",
      tipo: "abono",
    });
  });

  it("acepta la fecha escrita con el día primero y guarda categoría y comercio", () => {
    expect(
      validarManual(campos({ fecha: "5/10/2026", categoria: " Comida ", comercio: "Tacos" }), HOY).movimiento
    ).toMatchObject({ fecha: "2026-10-05", categoria: "Comida", comercio: "Tacos" });
  });

  it("rechaza lo que no se puede guardar", () => {
    expect(validarManual(campos({ fecha: "" }), HOY).error).toMatch(/fecha/);
    expect(validarManual(campos({ fecha: "2026-10-15" }), HOY).error).toMatch(/después de hoy/);
    expect(validarManual(campos({ descripcion: "   " }), HOY).error).toMatch(/descripción/);
    expect(validarManual(campos({ monto: "" }), HOY).error).toMatch(/monto/);
    expect(validarManual(campos({ monto: "abc" }), HOY).error).toMatch(/no se entiende/);
    expect(validarManual(campos({ monto: "0" }), HOY).error).toMatch(/mayor que cero/);
    expect(validarManual(campos({ monto: "9999999999" }), HOY).error).toMatch(/demasiado grande/);
  });
});

describe("lineaLibre", () => {
  it("usa la línea tal cual si está libre y si no, el siguiente sufijo", () => {
    expect(lineaLibre("x", [])).toBe("x");
    expect(lineaLibre("x", ["x"])).toBe("x (2)");
    expect(lineaLibre("x", ["x", "x (2)", "x (3)"])).toBe("x (4)");
  });
});
