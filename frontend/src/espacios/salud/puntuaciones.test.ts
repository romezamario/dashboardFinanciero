import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import { recuperacion } from "./indicadores";
import { historialPuntuaciones, minutosDesde18, nivelDe, puntuacionActividad, puntuacionSueno } from "./puntuaciones";
import type { DiaSalud, Noche, SesionEjercicio } from "./salud";

const noche = (cambios: Partial<Noche> = {}): Noche => ({
  start: "23:00",
  in_bed_h: 8.5,
  efficiency: 94,
  deep_pct: 20,
  rem_pct: 22,
  metrics: { asleep_min: 480, sol_min: 12, waso_min: 15 },
  ...cambios,
});
const dia = (fecha: string, extra: Partial<DiaSalud> = {}): DiaSalud => ({ fecha, ...extra });
const sesion = (min: number, vig = 0): SesionEjercicio => ({
  inicio: 1,
  fin: 2,
  duracion_min: min + vig,
  met_prom: 4,
  min_moderados: min,
  min_vigorosos: vig,
  intensidad: vig ? "vigorosa" : "moderada",
});

describe("puntuacionSueno", () => {
  const previas = ["2026-11-10", "2026-11-11", "2026-11-12"].map((f) => dia(f, { noche: noche() }));

  it("una noche completa a tu hora: 100 con todos los componentes", () => {
    const p = puntuacionSueno([...previas, dia("2026-11-13", { noche: noche() })])!;
    expect(p.fecha).toBe("2026-11-13");
    expect(p.puntaje).toBe(100);
    expect(p.nivel).toBe("bien");
    expect(p.componentes.map((c) => c.clave)).toEqual(["duracion", "eficiencia", "profundo", "rem", "latencia", "interrupciones", "horario"]);
  });

  it("6 h, tarde y con interrupciones baja la puntuación", () => {
    const mala = noche({ start: "01:30", efficiency: 80, metrics: { asleep_min: 360, sol_min: 40, waso_min: 60 } });
    const p = puntuacionSueno([...previas, dia("2026-11-13", { noche: mala })])!;
    const c = Object.fromEntries(p.componentes.map((x) => [x.clave, x]));
    expect(c.duracion.puntos).toBe(60);
    expect(c.eficiencia.puntos).toBe(60);
    expect(c.latencia.puntos).toBe(50);
    expect(c.interrupciones.puntos).toBe(50);
    expect(c.horario.puntos).toBe(0);
    expect(c.horario.texto).toBe("2 h 30 min más tarde que tu hora habitual");
    expect(p.puntaje).toBeLessThan(70);
  });

  it("sin datos opcionales reparte el peso; sin duración no hay puntuación", () => {
    const p = puntuacionSueno([dia("2026-11-13", { noche: { metrics: { asleep_min: 420 } } })])!;
    expect(p.componentes).toHaveLength(1);
    expect(p.puntaje).toBe(80);
    expect(puntuacionSueno([dia("2026-11-13", { noche: {} })])).toBeNull();
    expect(puntuacionSueno([])).toBeNull();
  });

  it("hora desde las 18:00 y niveles", () => {
    expect(minutosDesde18("23:00")).toBe(300);
    expect(minutosDesde18("01:30")).toBe(450);
    expect(minutosDesde18("x")).toBeNull();
    expect([nivelDe(70), nivelDe(69), nivelDe(49)]).toEqual(["bien", "regular", "bajo"]);
  });
});

describe("puntuacionActividad", () => {
  const base = Array.from({ length: 6 }, (_, i) => dia(`2026-11-0${i + 1}`, { actividad: { steps: 6000, active_kcal: 400 }, ejercicio: [] }));

  it("pasos, calorías vs. tu normal, frecuencia y volumen de 7 días", () => {
    const hoy = dia("2026-11-07", { actividad: { steps: 8000, active_kcal: 480 }, ejercicio: [sesion(30, 10)] });
    const dias = [...base.slice(0, 4), { ...base[4], ejercicio: [sesion(40)] }, { ...base[5], ejercicio: [sesion(30)] }, hoy];
    const p = puntuacionActividad(dias)!;
    const c = Object.fromEntries(p.componentes.map((x) => [x.clave, x.puntos]));
    expect(c).toEqual({ pasos: 100, kcal: 100, frecuencia: 100, volumen: 80 });
    expect(p.puntaje).toBe(95);
  });

  it("sin sesiones subidas (colector viejo) no se juzga el ejercicio", () => {
    const dias = [dia("2026-11-07", { actividad: { steps: 4000 } })];
    const p = puntuacionActividad(dias)!;
    expect(p.componentes.map((x) => x.clave)).toEqual(["pasos"]);
    expect(p.puntaje).toBe(50);
    expect(puntuacionActividad([dia("2026-11-07")])).toBeNull();
  });
});

describe("recuperación con sueño, balance y actividad de ayer", () => {
  const vit = { hrv_ms: 50, rhr: 55, skin_temp: 35, breath_rate: 15 };
  const dias = Array.from({ length: 10 }, (_, i) =>
    dia(`2026-11-${String(i + 1).padStart(2, "0")}`, { noche: noche(vit), actividad: { active_kcal: 400 } }),
  );

  it("un día muy activo ayer resta", () => {
    const conCarga = dias.map((d) => (d.fecha === "2026-11-09" ? { ...d, actividad: { active_kcal: 1000 } } : d));
    const r = recuperacion(conCarga)!;
    const carga = r.factores.find((f) => f.clave === "carga")!;
    expect(carga.puntos).toBe(16);
    expect(r.factores.find((f) => f.clave === "sueno")!.puntos).toBe(100);
    expect(r.factores.find((f) => f.clave === "balance")!.puntos).toBe(100);
  });

  it("historial con las tres", () => {
    const h = historialPuntuaciones(dias, ["2026-11-09", "2026-11-10"], (f) => recuperacion(dias, f)?.puntaje ?? null);
    expect(h).toHaveLength(2);
    expect(h[1].sueno).toBe(100);
    expect(h[1].recuperacion).not.toBeNull();
    expect(h[1].actividad).not.toBeNull();
  });
});
