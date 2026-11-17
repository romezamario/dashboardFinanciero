import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import {
  aplicarGuardadas,
  diasConEjercicio,
  ejemplosConfirmados,
  etiquetaDeSesion,
  horaEnZona,
  minutosPorDia,
  resumenEjercicio,
  sesionesRecientes,
  sinDescartadas,
  sugerirTipo,
  type EtiquetaEjercicio,
} from "./ejercicio";
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

describe("tipo de actividad", () => {
  const caminata = { ...sesion(10_000, 30, 0, 90), lpm_mediana: 105 };
  const carrera = { ...sesion(20_000, 5, 25, 300), met_prom: 8, lpm_mediana: 150 };
  const etiqueta = (inicio: number, fin: number, tipo: string, estado: EtiquetaEjercicio["estado"] = "confirmada"): EtiquetaEjercicio => ({
    inicio,
    fin,
    fecha: "2026-11-15",
    tipo,
    estado,
  });

  it("sin ejemplos sugiere por reglas: MET o FC altos = correr, lo demás caminata", () => {
    expect(sugerirTipo(caminata).tipo).toBe("caminata");
    expect(sugerirTipo(carrera).tipo).toBe("correr");
    expect(sugerirTipo({ ...caminata, met_prom: 5, lpm_mediana: 140 }).tipo).toBe("correr");
    expect(sugerirTipo({ ...caminata, met_prom: 5, lpm_mediana: undefined }).tipo).toBe("caminata");
  });

  it("con 3 o más confirmadas usa las más parecidas", () => {
    const ejemplos = [
      { sesion: { ...caminata, met_prom: 3.5 }, tipo: "no_ejercicio" },
      { sesion: { ...caminata, met_prom: 3.6 }, tipo: "no_ejercicio" },
      { sesion: carrera, tipo: "correr" },
    ];
    const s = sugerirTipo({ ...caminata, met_prom: 3.4 }, ejemplos);
    expect(s.tipo).toBe("no_ejercicio");
    expect(s.motivo).toMatch(/confirmaste/);
  });

  it("encuentra la etiqueta por inicio o por traslape si el colector movió la sesión", () => {
    const e = etiqueta(10_000 + 120, 10_000 + 1900, "caminata");
    expect(etiquetaDeSesion(caminata, [e])).toBe(e);
    expect(etiquetaDeSesion(caminata, [etiqueta(10_000 + 1700, 10_000 + 4000, "correr")])).toBeNull();
  });

  it("agrupa por día, del más reciente al más antiguo, con sugeridas y confirmadas", () => {
    const dias2: DiaSalud[] = [
      { fecha: "2026-11-14", ejercicio: [carrera] },
      { fecha: "2026-11-15", ejercicio: [{ ...caminata, inicio: 40_000, fin: 41_800 }, caminata] },
      { fecha: "2026-11-16" },
    ];
    const r = diasConEjercicio(dias2, [etiqueta(10_000, 11_800, "no_ejercicio")]);
    expect(r.map((d) => d.fecha)).toEqual(["2026-11-15", "2026-11-14"]);
    const [dom, sab] = r;
    expect(dom.sesiones.map((s) => [s.inicio, s.tipo, s.confirmada])).toEqual([
      [10_000, "no_ejercicio", true],
      [40_000, "caminata", false],
    ]);
    // "No fue ejercicio" no suma minutos ni kcal.
    expect(dom.minutos).toBe(30);
    expect(dom.kcal).toBe(90);
    expect(dom.porConfirmar).toBe(1);
    expect(dom.tipos).toEqual([{ tipo: "caminata", minutos: 30 }]);
    expect(sab.tipos).toEqual([{ tipo: "correr", minutos: 30 }]);
  });

  it("una sugerencia guardada por el colector se muestra como sugerida", () => {
    const [d] = diasConEjercicio([{ fecha: "2026-11-15", ejercicio: [caminata] }], [etiqueta(10_000, 11_800, "nadar", "sugerida")]);
    expect(d.sesiones[0]).toMatchObject({ tipo: "nadar", confirmada: false });
  });

  it("ejemplos = sesiones con etiqueta confirmada", () => {
    const ej = ejemplosConfirmados([{ fecha: "2026-11-15", ejercicio: [caminata, carrera] }], [etiqueta(20_000, 21_800, "correr"), etiqueta(10_000, 11_800, "nadar", "sugerida")]);
    expect(ej.map((e) => e.tipo)).toEqual(["correr"]);
  });

  it("las confirmadas como 'no fue ejercicio' no cuentan en el resumen", () => {
    const d = sinDescartadas([{ fecha: "2026-11-15", ejercicio: [caminata, carrera] }], [etiqueta(10_000, 11_800, "no_ejercicio")]);
    expect(d[0].ejercicio).toEqual([carrera]);
  });

  it("al guardar reemplaza la etiqueta vieja aunque tuviera otro inicio", () => {
    const vieja = { ...etiqueta(9_900, 11_700, "caminata"), id: 1 };
    const [d] = diasConEjercicio([{ fecha: "2026-11-15", ejercicio: [caminata] }], [vieja]);
    const nueva = { ...etiqueta(10_000, 11_800, "correr"), id: 2 };
    expect(aplicarGuardadas([vieja, etiqueta(1, 2, "otro")], [nueva], d.sesiones)).toEqual([etiqueta(1, 2, "otro"), nueva]);
  });
});
