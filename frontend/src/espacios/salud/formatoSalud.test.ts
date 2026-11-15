import { describe, expect, it } from "vitest";
import { horaDe, horaDecimal } from "./formatoSalud";
import { filaADia } from "./salud";

describe("horas en la zona del día (auditoría A2)", () => {
  // 2026-11-10 05:30 UTC = 23:30 del 9 en CDMX (-360) y 21:30 en Las Vegas (-480).
  const t = Date.UTC(2026, 10, 10, 5, 30) / 1000;

  it("con la zona del día no depende del navegador", () => {
    expect(horaDe(t, -360)).toBe("23:30");
    expect(horaDe(t, -480)).toBe("21:30");
    expect(horaDe(t, 0)).toBe("05:30");
    expect(horaDecimal(t, -360)).toBe(23.5);
  });

  it("filaADia lee la zona que anotó el colector", () => {
    expect(filaADia({ fecha: "2026-11-10", datos: { utc_offset_min: -480 } }).utcOffset).toBe(-480);
    expect(filaADia({ fecha: "2026-11-10", datos: {} }).utcOffset).toBeUndefined();
  });
});
