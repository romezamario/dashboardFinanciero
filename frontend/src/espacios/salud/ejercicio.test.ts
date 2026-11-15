import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import { horaEnZona, minutosPorDia, resumenEjercicio, sesionesRecientes } from "./ejercicio";
import type { DiaSalud, SesionEjercicio } from "./salud";

const sesion = (inicio: number, mod: number, vig: number, kcal?: number): SesionEjercicio => ({
  inicio,
  fin: inicio + (mod + vig) * 60,
  duracion_min: mod + vig,
  met_prom: vig > mod ? 7 : 4,
  min_moderados: mod,
  min_vigorosos: vig,
  intensidad: vig > mod ? "vigorosa" : "moderada",
  kcal,
});

const dias: DiaSalud[] = [
  { fecha: "2026-11-09", ejercicio: [sesion(1000, 30, 0, 150)] },
  { fecha: "2026-11-10" },
  { fecha: "2026-11-15", ejercicio: [sesion(5000, 10, 20, 300), sesion(3000, 20, 0)] },
];

describe("ejercicio", () => {
  it("lista las sesiones de la más reciente a la más antigua, con su fecha", () => {
    expect(sesionesRecientes(dias).map((s) => [s.fecha, s.inicio])).toEqual([
      ["2026-11-15", 5000],
      ["2026-11-15", 3000],
      ["2026-11-09", 1000],
    ]);
  });

  it("minutos por día, con 0 en días sin ejercicio", () => {
    expect(minutosPorDia(dias)).toEqual([
      { fecha: "2026-11-09", moderados: 30, vigorosos: 0 },
      { fecha: "2026-11-10", moderados: 0, vigorosos: 0 },
      { fecha: "2026-11-15", moderados: 30, vigorosos: 20 },
    ]);
  });

  it("resume el periodo: minutos vigorosos valen doble y las semanas salen de los días con datos", () => {
    const r = resumenEjercicio(dias)!;
    expect(r.sesiones).toBe(3);
    expect(r.minutos).toBe(80);
    expect(r.kcal).toBe(450);
    // 7 días (9 al 15) = 1 semana; 30 + 10 + 40 + 20 = 100 equivalentes.
    expect(r.semanas).toBe(1);
    expect(r.equivalentesPorSemana).toBe(100);
    expect(resumenEjercicio([])).toBeNull();
    expect(resumenEjercicio([{ fecha: "2026-11-09", ejercicio: [sesion(1, 15, 0)] }])?.kcal).toBeNull();
  });

  it("da la hora en la zona de ese momento", () => {
    const unix = Date.parse("2026-11-13T15:30:00Z") / 1000;
    expect(horaEnZona(unix, -360)).toBe("09:30");
    expect(horaEnZona(unix, -480)).toBe("07:30");
  });
});
