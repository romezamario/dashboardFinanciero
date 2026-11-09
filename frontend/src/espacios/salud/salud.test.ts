import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import {
  celdasHR,
  cruceSuenoGasto,
  desviacionTemperatura,
  fasesPorNoche,
  filaADia,
  horarioSueno,
  mensajeErrorSalud,
  minutosDormido,
  relojDesde18,
  segmentosHipnograma,
  serieNoche,
  sumarPorFecha,
  tarjetasHoy,
  tendencia,
  ultimosDias,
  type DiaSalud,
} from "./salud";

const dia = (fecha: string, noche: DiaSalud["noche"] = {}, extra: Partial<DiaSalud> = {}): DiaSalud => ({
  fecha,
  noche,
  ...extra,
});

describe("mensajeErrorSalud", () => {
  it("esquema no expuesto = falta la migración", () => {
    expect(mensajeErrorSalud({ code: "PGRST106", message: "x" })).toMatch(/falta aplicar su migración/);
    expect(mensajeErrorSalud({ message: "The schema must be one of the following: public" })).toMatch(/migración/);
  });
  it("cualquier otro error es genérico", () => {
    expect(mensajeErrorSalud({ code: "42501" })).toMatch(/Intenta de nuevo/);
    expect(mensajeErrorSalud(null)).toMatch(/Intenta de nuevo/);
  });
});

describe("filaADia", () => {
  it("toma los campos que sube el colector", () => {
    const d = filaADia({
      fecha: "2026-11-09",
      datos: { noche: { rhr: 77 }, deuda_sueno: { shortfall_min: 411 }, actividad: { steps: 300 }, hr_horas: [] },
    });
    expect(d).toEqual({
      fecha: "2026-11-09",
      noche: { rhr: 77 },
      deuda: { shortfall_min: 411 },
      actividad: { steps: 300 },
      hrHoras: [],
    });
    expect(filaADia({ fecha: "2026-11-09", datos: null }).noche).toBeUndefined();
  });
});

describe("minutosDormido", () => {
  it("usa el dato medido o lo estima de cama y despierto", () => {
    expect(minutosDormido({ metrics: { asleep_min: 69 } })).toBe(69);
    expect(minutosDormido({ in_bed_h: 2, wake_pct: 25 })).toBe(90);
    expect(minutosDormido(undefined)).toBeNull();
  });
});

describe("tarjetasHoy", () => {
  it("compara el último valor con el promedio de los 7 anteriores", () => {
    const dias = [60, 62, 64].map((rhr, i) => dia(`2026-11-0${i + 1}`, { rhr }));
    const rhr = tarjetasHoy(dias).find((t) => t.metrica.clave === "rhr")!;
    expect(rhr.valor).toBe(64);
    expect(rhr.normal).toBe(61);
    expect(rhr.cambio).toBe(3);
  });
  it("sin datos: todo null", () => {
    const t = tarjetasHoy([])[0];
    expect([t.valor, t.normal, t.cambio]).toEqual([null, null, null]);
  });
});

describe("segmentosHipnograma", () => {
  it("une celdas iguales y reparte el tiempo de la noche", () => {
    const s = segmentosHipnograma({ start_unix: 0, end_unix: 400, stages: [4, 4, 2, 1] });
    expect(s).toEqual([
      { inicio: 0, fin: 200, fase: 4 },
      { inicio: 200, fin: 300, fase: 2 },
      { inicio: 300, fin: 400, fase: 1 },
    ]);
    expect(segmentosHipnograma({ stages: [1] })).toEqual([]);
  });
});

describe("serieNoche", () => {
  it("convierte pares [t, valor]", () => {
    expect(serieNoche({ series_t: { hr: [[10, 70], [20, 72]] } }, "hr")).toEqual([
      { t: 10, valor: 70 },
      { t: 20, valor: 72 },
    ]);
    expect(serieNoche(undefined, "hrv")).toEqual([]);
  });
});

describe("fasesPorNoche", () => {
  it("minutos por fase y deuda acumulada", () => {
    const r = fasesPorNoche([
      dia("2026-11-08", { in_bed_h: 2, deep_pct: 10, light_pct: 50, rem_pct: 20, wake_pct: 20 }, { deuda: { shortfall_min: 100 } }),
      dia("2026-11-09", { in_bed_h: 8, deep_pct: 25, light_pct: 50, rem_pct: 25, wake_pct: 0 }, { deuda: { shortfall_min: -20 } }),
      dia("2026-11-10", {}),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ profundo: 12, ligero: 60, rem: 24, despierto: 24, deudaAcumulada: 100 });
    expect(r[1].deudaAcumulada).toBe(80);
  });
});

describe("tendencia y temperatura", () => {
  const dias = ["01", "02", "03", "04"].map((d, i) => dia(`2026-11-${d}`, { hrv_ms: [30, 32, 34, 50][i], skin_temp: [36, 36.2, 36.4, 37][i] }));
  it("banda normal solo con 3+ días previos", () => {
    const t = tendencia(dias, (d) => d.noche?.hrv_ms ?? null);
    expect(t[2].base).toBeNull();
    expect(t[3].base).toBe(32);
    expect(t[3].bajo).toBe(30);
    expect(t[3].alto).toBe(34);
  });
  it("desviación de temperatura contra la línea base", () => {
    const t = desviacionTemperatura(dias);
    expect(t[0].desviacion).toBeNull();
    expect(t[3].desviacion).toBe(0.8);
  });
});

describe("horarioSueno", () => {
  it("cruza la medianoche como tramo continuo desde las 18:00", () => {
    expect(horarioSueno([dia("2026-11-09", { start: "22:01", end: "06:30" })])).toEqual([
      { fecha: "2026-11-09", rango: [241, 750] },
    ]);
    expect(relojDesde18(241)).toBe("22:01");
    expect(relojDesde18(750)).toBe("06:30");
    expect(horarioSueno([dia("x", {})])).toEqual([]);
  });
});

describe("ultimosDias", () => {
  it("cuenta desde el día más reciente con datos", () => {
    const dias = ["2026-10-01", "2026-11-03", "2026-11-09"].map((f) => dia(f));
    expect(ultimosDias(dias, 7).map((d) => d.fecha)).toEqual(["2026-11-03", "2026-11-09"]);
    expect(ultimosDias([], 7)).toEqual([]);
  });
});

describe("celdasHR y cruce", () => {
  it("celdas día × hora", () => {
    expect(celdasHR([dia("2026-11-08", {}, { hrHoras: [{ hora: 16, mediana: 87 }] })])).toEqual([
      { fecha: "2026-11-08", hora: 16, mediana: 87 },
    ]);
  });
  it("gasto por día y cruce con horas dormidas", () => {
    const gasto = sumarPorFecha([
      { fecha: "2026-11-09", monto: 100 },
      { fecha: "2026-11-09", monto: 50.5 },
    ]);
    expect(gasto.get("2026-11-09")).toBe(150.5);
    expect(cruceSuenoGasto([dia("2026-11-09", { metrics: { asleep_min: 450 } }), dia("2026-11-10", { metrics: { asleep_min: 300 } })], gasto)).toEqual([
      { fecha: "2026-11-09", horas: 7.5, gasto: 150.5 },
      { fecha: "2026-11-10", horas: 5, gasto: 0 },
    ]);
  });
});
