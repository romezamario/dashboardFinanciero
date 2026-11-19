import { describe, expect, it } from "vitest";
import { diasConPuntajesOura, estresPorMes, puntajesPorSemana, resumenOura, seriesSemanales, ultimosDeOura } from "./puntajesOura";
import type { DiaSalud, ExtrasOuraApp } from "./salud";

const dia = (fecha: string, ouraApp?: ExtrasOuraApp) => ({ fecha, ouraApp }) as unknown as DiaSalud;

describe("puntajes de la app de Oura", () => {
  const dias = [
    dia("2026-11-01", { puntaje_sueno: 80, preparacion: 70, estres_dia: "normal", vo2max: 44, edad_cardiovascular: 35 }),  // domingo
    dia("2026-11-03", { puntaje_sueno: 90, preparacion: 60, puntaje_actividad: 85, estres_dia: "stressful" }),
    dia("2026-11-04", { puntaje_sueno: 70, estres_dia: "stressful", vo2max: 45 }),
    dia("2026-11-05"),
    dia("2026-12-01", { estres_dia: "restored", edad_cardiovascular: 34 }),
  ];

  it("se queda solo con los días con datos de la app", () => {
    expect(diasConPuntajesOura(dias).map((d) => d.fecha)).toEqual(["2026-11-01", "2026-11-03", "2026-11-04", "2026-12-01"]);
  });

  it("recorta los últimos n días desde el último con datos", () => {
    expect(ultimosDeOura(dias, 7).map((d) => d.fecha)).toEqual(["2026-12-01"]);
    expect(ultimosDeOura(dias, null)).toHaveLength(5);
  });

  it("promedia por semana de lunes a domingo", () => {
    const s = puntajesPorSemana(dias);
    expect(s[0]).toEqual({ semana: "2026-10-26", puntaje_sueno: 80, preparacion: 70, puntaje_actividad: null });
    expect(s[1]).toEqual({ semana: "2026-11-02", puntaje_sueno: 80, preparacion: 60, puntaje_actividad: 85 });
    expect(s).toHaveLength(2); // la semana del 1 dic no tiene puntajes
  });

  it("resume promedios, VO2 máx., edad cardiovascular y estrés", () => {
    const r = resumenOura(diasConPuntajesOura(dias))!;
    expect(r.promedios).toEqual({ puntaje_sueno: 80, preparacion: 65, puntaje_actividad: 85 });
    expect(r.vo2max).toEqual({ ultimo: { fecha: "2026-11-04", valor: 45 }, cambio: 1 });
    expect(r.edadCardiovascular).toEqual({ ultimo: { fecha: "2026-12-01", valor: 34 }, cambio: -1 });
    expect(r.estres).toEqual([
      { estado: "restored", dias: 1, pct: 25 },
      { estado: "normal", dias: 1, pct: 25 },
      { estado: "stressful", dias: 2, pct: 50 },
    ]);
    expect(resumenOura([])).toBeNull();
  });

  it("cuenta el estrés por mes y deja la última lectura semanal de VO2 máx.", () => {
    expect(estresPorMes(dias)).toEqual([
      { mes: "2026-11", restored: 0, normal: 1, stressful: 2 },
      { mes: "2026-12", restored: 1, normal: 0, stressful: 0 },
    ]);
    const c = seriesSemanales(dias);
    expect(c.find((s) => s.semana === "2026-11-02")).toEqual({ semana: "2026-11-02", vo2max: 45, edad: null });
  });
});
