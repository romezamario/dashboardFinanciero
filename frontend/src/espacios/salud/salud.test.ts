import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import {
  celdasHR,
  desviacionTemperatura,
  extremoNoche,
  extremoPuntual,
  fasesPorNoche,
  filaADia,
  haceCuanto,
  horarioSueno,
  nivelBateria,
  mensajeErrorSalud,
  minutosDormido,
  mismoExtremo,
  relojDesde18,
  segmentosHipnograma,
  serieNoche,
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

describe("batería", () => {
  it("niveles", () => {
    expect(nivelBateria(9)).toBe("critica");
    expect(nivelBateria(10)).toBe("baja");
    expect(nivelBateria(19)).toBe("baja");
    expect(nivelBateria(20)).toBe("ok");
  });
  it("hace cuánto", () => {
    const ahora = new Date("2026-11-09T15:00:00Z");
    expect(haceCuanto("2026-11-09T14:59:50Z", ahora)).toBe("hace un momento");
    expect(haceCuanto("2026-11-09T14:40:00Z", ahora)).toBe("hace 20 min");
    expect(haceCuanto("2026-11-09T12:00:00Z", ahora)).toBe("hace 3 h");
    expect(haceCuanto("2026-11-06T15:00:00Z", ahora)).toBe("hace 3 días");
  });
});

describe("extremoNoche", () => {
  const serie = (v: number[]) => v.map((valor, i) => ({ t: i * 300, valor }));
  it("mínimo sostenido de HR: ignora un solo valor atípico", () => {
    // 40 es un pico aislado; el mínimo sostenido es 57 (t=1500).
    expect(extremoNoche(serie([70, 65, 40, 66, 60, 57, 57, 58, 71]), "min")).toEqual({ t: 1500, valor: 57 });
  });
  it("máximo sostenido de HRV", () => {
    expect(extremoNoche(serie([30, 200, 31, 45, 50, 48, 35]), "max")).toEqual({ t: 1200, valor: 48 });
  });
  it("pocas lecturas o ninguna", () => {
    expect(extremoNoche(serie([80, 70]), "min")).toEqual({ t: 300, valor: 70 });
    expect(extremoNoche([], "max")).toBeNull();
  });
  it("puntual = el valor crudo, aunque sea un solo pico", () => {
    const hr = serie([70, 65, 40, 66, 60, 57, 57, 58, 71]);
    expect(extremoPuntual(hr, "min")).toEqual({ t: 600, valor: 40 });
    expect(mismoExtremo(extremoNoche(hr, "min"), extremoPuntual(hr, "min"))).toBe(false);
    const parejo = serie([60, 55, 50, 55, 60]);
    expect(mismoExtremo(extremoNoche(parejo, "min"), extremoPuntual(parejo, "min"))).toBe(false);
    const meseta = serie([60, 50, 50, 50, 60]);
    expect(mismoExtremo(extremoNoche(meseta, "min"), extremoPuntual(meseta, "min"))).toBe(true);
    expect(extremoPuntual([], "max")).toBeNull();
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
});
