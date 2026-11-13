import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import {
  constanciaHorario,
  diasConTemperatura,
  estadoNoche,
  horaFueraDeLoNormal,
  minutosPeriodo,
  periodosDelDia,
  puntajeSueno,
  recuperacion,
  siestasDelDia,
  temperaturaDelDia,
} from "./indicadores";
import type { DiaSalud, Noche } from "./salud";

const dia = (fecha: string, noche?: Noche, extra: Partial<DiaSalud> = {}): DiaSalud => ({ fecha, noche, ...extra });
const normal = (fecha: string, cambios: Partial<Noche> = {}) =>
  dia(fecha, { hrv_ms: 50, rhr: 55, skin_temp: 35, breath_rate: 15, metrics: { asleep_min: 480 }, ...cambios });

describe("estadoNoche", () => {
  it("distingue noche, anillo apagado y sin datos", () => {
    expect(estadoNoche(dia("2026-11-12", {}))).toBe("con-datos");
    expect(estadoNoche(dia("2026-11-13", undefined, { apagones: [{ inicio: 1, fin: 2, horas: 10.7 }] }))).toBe("sin-bateria");
    expect(estadoNoche(dia("2026-11-13", undefined, { apagones: [{ inicio: 1, fin: 2, horas: 1 }] }))).toBe("sin-datos");
    expect(estadoNoche(undefined)).toBe("sin-datos");
  });
});

describe("periodos", () => {
  it("ordena los periodos y cuenta siestas", () => {
    const d = dia("2026-11-12", {}, {
      periodos: [
        { inicio: 36000, fin: 43200, en_cama_h: 2, principal: false },
        { inicio: 1000, fin: 11800, dormido_min: 170, principal: true },
      ],
    });
    expect(periodosDelDia(d).map((p) => p.inicio)).toEqual([1000, 36000]);
    expect(siestasDelDia(d)).toBe(1);
    expect(minutosPeriodo(periodosDelDia(d)[0])).toBe(170);
    expect(minutosPeriodo(periodosDelDia(d)[1])).toBe(120);
  });

  it("sin periodos (filas viejas) usa la noche", () => {
    const d = dia("2026-11-10", { start_unix: 1, end_unix: 2, in_bed_h: 7, metrics: { asleep_min: 400 } });
    expect(periodosDelDia(d)).toHaveLength(1);
    expect(periodosDelDia(d)[0].principal).toBe(true);
    expect(siestasDelDia(d)).toBe(0);
    expect(periodosDelDia(dia("2026-11-10"))).toEqual([]);
  });
});

describe("recuperacion", () => {
  const base = ["2026-11-09", "2026-11-10", "2026-11-11"].map((f) => normal(f));

  it("sin noches suficientes de base no hay semáforo", () => {
    expect(recuperacion([normal("2026-11-10"), normal("2026-11-11")])).toBeNull();
    expect(recuperacion([])).toBeNull();
  });

  it("igual a tu normal con 8 h: listo", () => {
    const r = recuperacion([...base, normal("2026-11-12")])!;
    expect(r.fecha).toBe("2026-11-12");
    expect(r.nivel).toBe("listo");
    expect(r.nochesBase).toBe(3);
    expect(r.factores.map((f) => f.clave).sort()).toEqual(["hrv", "resp", "rhr", "sueno", "temp"]);
  });

  it("HRV baja, FC alta, fiebre y poco sueño: descansa", () => {
    const r = recuperacion([...base, normal("2026-11-12", { hrv_ms: 38, rhr: 61, skin_temp: 35.8, breath_rate: 17, metrics: { asleep_min: 240 } })])!;
    expect(r.nivel).toBe("descansa");
    const hrv = r.factores.find((f) => f.clave === "hrv")!;
    expect(hrv.texto).toBe("−12 ms vs. tu normal");
    expect(hrv.puntos).toBe(0);
  });

  it("más HRV que tu normal no pasa de 100 puntos", () => {
    const r = recuperacion([...base, normal("2026-11-12", { hrv_ms: 70 })])!;
    expect(r.factores.find((f) => f.clave === "hrv")!.puntos).toBe(100);
  });

  it("solo el sueño no basta", () => {
    expect(recuperacion([dia("2026-11-09", { metrics: { asleep_min: 400 } })])).toBeNull();
  });

  it("puntaje de sueño de oura.exe", () => {
    expect(puntajeSueno(dia("2026-11-12", { sleep_score: { score: 81 } }))).toBe(81);
    expect(puntajeSueno(dia("2026-11-12", {}))).toBeNull();
  });
});

describe("constanciaHorario", () => {
  it("necesita 3 noches y clasifica por la peor desviación", () => {
    expect(constanciaHorario([dia("a", { start: "23:00", end: "07:00" })])).toBeNull();
    const constante = constanciaHorario([
      dia("2026-11-09", { start: "23:00", end: "07:00" }),
      dia("2026-11-10", { start: "23:10", end: "07:05" }),
      dia("2026-11-11", { start: "22:50", end: "06:55" }),
    ])!;
    expect(constante.nivel).toBe("muy-constante");
    expect(constante.dormirPromedio).toBe(5 * 60); // 23:00 = 5 h después de las 18:00
    const irregular = constanciaHorario([
      dia("2026-11-09", { start: "22:00", end: "06:00" }),
      dia("2026-11-10", { start: "01:30", end: "09:30" }),
      dia("2026-11-11", { start: "23:00", end: "07:00" }),
    ])!;
    expect(irregular.nivel).toBe("irregular");
  });
});

describe("temperatura del día", () => {
  const dias = [
    dia("2026-11-10", undefined, { tempHoras: [{ hora: 3, mediana: 35.6 }, { hora: 12, mediana: 32.0 }] }),
    dia("2026-11-11", undefined, { tempHoras: [{ hora: 3, mediana: 35.8 }, { hora: 12, mediana: 32.2 }] }),
    dia("2026-11-12", undefined, { tempHoras: [{ hora: 3, mediana: 35.7 }, { hora: 12, mediana: 33.3 }] }),
    dia("2026-11-13"),
  ];

  it("compara cada hora con el promedio de los otros días", () => {
    const p = temperaturaDelDia(dias, "2026-11-12");
    expect(p).toHaveLength(24);
    expect(p[3]).toEqual({ hora: 3, valor: 35.7, normal: 35.7 });
    expect(p[12]).toEqual({ hora: 12, valor: 33.3, normal: 32.1 });
    expect(p[0]).toEqual({ hora: 0, valor: null, normal: null });
    expect(horaFueraDeLoNormal(p)?.hora).toBe(12);
    expect(horaFueraDeLoNormal(temperaturaDelDia(dias, "2026-11-11"))).toBeNull();
  });

  it("lista los días con temperatura, del más reciente", () => {
    expect(diasConTemperatura(dias)).toEqual(["2026-11-12", "2026-11-11", "2026-11-10"]);
  });
});
