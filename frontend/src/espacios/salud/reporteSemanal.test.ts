import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import { armarReporte, frasesReporte } from "./reporteSemanal";
import type { DiaSalud, Noche, SesionEjercicio } from "./salud";

const fecha = (i: number) => new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10); // 0 = lunes 2 nov
const sesion = (inicio: number, min: number, vig = 0): SesionEjercicio => ({
  inicio,
  fin: inicio + min * 60,
  hora: "07:00",
  duracion_min: min,
  met_prom: 4,
  met_max: 6,
  min_moderados: min - vig,
  min_vigorosos: vig,
  intensidad: vig ? "vigorosa" : "moderada",
});
const dia = (i: number, n: Partial<Noche>, pasos: number, ejercicio: SesionEjercicio[] = []): DiaSalud => ({
  fecha: fecha(i),
  noche: { hrv_ms: 50, rhr: 55, skin_temp: 35, breath_rate: 15, start: "23:00", end: "07:00", metrics: { asleep_min: 450 }, ...n },
  actividad: { steps: pasos, active_kcal: 300 },
  ejercicio,
});

// Semana 1 (2–8 nov): 7 h 30, 6,000 pasos, una caminata de 30 min.
// Semana 2 (9–15 nov): 6 h, 9,000 pasos, dos carreras de 40 min (20 vigorosos).
const dias = [
  ...Array.from({ length: 7 }, (_, i) => dia(i, {}, 6000, i === 2 ? [sesion(1_000_000 + i * 86400, 30)] : [])),
  ...Array.from({ length: 7 }, (_, i) => dia(7 + i, { metrics: { asleep_min: 360 } }, 9000, i % 3 === 0 && i < 6 ? [sesion(2_000_000 + i * 86400, 40, 20)] : [])),
];

describe("reporte semanal", () => {
  const r = armarReporte(dias, [], [], fecha(7));
  const fila = (nombre: string) => r.filas.find((f) => f.nombre.startsWith(nombre))!;

  it("compara sueño, actividad y ejercicio contra la semana anterior", () => {
    expect(r.lunes).toBe("2026-11-09");
    expect(r.domingo).toBe("2026-11-15");
    expect(fila("Sueño").veredicto).toBe("peor");
    expect(fila("Sueño").cambio).toBe("−90 min");
    expect(fila("Pasos").veredicto).toBe("mejor");
    expect(fila("Pasos").actual).toBe("9,000");
    expect(fila("Calorías").veredicto).toBe("igual");
    expect(r.ejercicio).toMatchObject({ sesiones: 2, minutos: 80, equivalentes: 120 });
    expect(fila("Minutos de ejercicio").veredicto).toBe("mejor");
    expect(fila("Minutos de ejercicio").actual).toBe("120 de 150");
  });

  it("las sesiones marcadas como 'no fue ejercicio' no cuentan", () => {
    const s = dias[7].ejercicio![0];
    const sin = armarReporte(dias, [], [{ inicio: s.inicio, fin: s.fin, fecha: fecha(7), tipo: "no_ejercicio", estado: "confirmada" }], fecha(7));
    expect(sin.ejercicio.sesiones).toBe(1);
  });

  it("frases de la semana", () => {
    const frases = frasesReporte(r);
    expect(frases[0]).toMatch(/^Mejoró: .*Pasos/);
    expect(frases.some((f) => /^Empeoró: Sueño/.test(f))).toBe(true);
    expect(frases.some((f) => /te faltaron 30 min/.test(f))).toBe(true);
  });

  it("sin datos lo dice", () => {
    const vacio = armarReporte([], [], [], fecha(7));
    expect(frasesReporte(vacio)[0]).toMatch(/No llegaron datos/);
    expect(vacio.filas.every((f) => f.veredicto === "sin-dato")).toBe(true);
  });
});
