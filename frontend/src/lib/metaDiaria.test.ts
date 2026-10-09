import { describe, expect, it } from "vitest";
import { diasDeLaSemana, diasDelMes, resumenDeMes, resumenDeSemana } from "./metaDiaria";

describe("diasDeLaSemana", () => {
  it("de domingo a sábado, también cruzando mes y año", () => {
    expect(diasDeLaSemana("2026-10-07")).toEqual([
      "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
    ]);
    // 2026-10-01 es jueves: su semana empieza el 27 de septiembre.
    expect(diasDeLaSemana("2026-10-01")[0]).toBe("2026-09-27");
    expect(diasDeLaSemana("2026-01-01")[0]).toBe("2025-12-28");
    // Un domingo es el primer día de su propia semana.
    expect(diasDeLaSemana("2026-10-04")[0]).toBe("2026-10-04");
  });
});

describe("resumenDeSemana", () => {
  const totales = new Map([
    ["2026-09-01", 100_000],
    ["2026-09-03", 200_000],
    ["2026-09-07", 700_000],
  ]);

  it("promedia sobre los 7 días; un día sin gasto dentro del rango cuenta como $0", () => {
    // Semana 6-12 sep: solo hay gasto el 7 ($7,000) -> $1,000 al día en 7 días.
    const r = resumenDeSemana("2026-09-09", totales, "2026-09-01", "2026-09-30");
    expect(r).toEqual({ desde: "2026-09-06", hasta: "2026-09-12", dias: 7, total: 700_000, promedio: 100_000 });
  });

  it("la semana a medias promedia solo los días hasta el corte", () => {
    // Corte el 8 (martes): del 6 al 8 son 3 días contables, no 7.
    const r = resumenDeSemana("2026-09-07", totales, "2026-09-01", "2026-09-08");
    expect(r).toMatchObject({ desde: "2026-09-06", hasta: "2026-09-08", dias: 3, total: 700_000 });
    expect(r?.promedio).toBe(233_333);
  });

  it("la primera semana empieza en el primer día con datos", () => {
    // Primer dato el 1 (martes): del 30 de agosto al 5 de sep solo cuentan 1..5.
    const r = resumenDeSemana("2026-09-02", totales, "2026-09-01", "2026-09-30");
    expect(r).toMatchObject({ desde: "2026-09-01", hasta: "2026-09-05", dias: 5, total: 300_000, promedio: 60_000 });
  });

  it("sin ningún día contable devuelve null", () => {
    expect(resumenDeSemana("2026-10-20", totales, "2026-09-01", "2026-09-15")).toBeNull();
    expect(resumenDeSemana("2026-08-10", totales, "2026-09-01", "2026-09-15")).toBeNull();
  });
});

describe("resumenDeMes", () => {
  const totales = new Map([
    ["2026-09-01", 100_000],
    ["2026-09-03", 200_000],
    ["2026-09-07", 700_000],
    ["2026-10-02", 999_000],
  ]);

  it("diasDelMes respeta los días del mes (también febrero bisiesto)", () => {
    expect(diasDelMes("2026-09")).toHaveLength(30);
    expect(diasDelMes("2026-10")).toHaveLength(31);
    expect(diasDelMes("2028-02")).toHaveLength(29);
    expect(diasDelMes("2026-09")[0]).toBe("2026-09-01");
  });

  it("promedia el mes completo: $10,000 en 30 días", () => {
    const r = resumenDeMes("2026-09", totales, "2026-09-01", "2026-10-31");
    expect(r).toMatchObject({ desde: "2026-09-01", hasta: "2026-09-30", dias: 30, total: 1_000_000 });
    expect(r?.promedio).toBe(33_333);
  });

  it("el mes en curso promedia hasta el corte y no cuenta los días siguientes", () => {
    const r = resumenDeMes("2026-09", totales, "2026-09-01", "2026-09-10");
    expect(r).toMatchObject({ dias: 10, total: 1_000_000, promedio: 100_000 });
  });

  it("un mes a medias por el principio cuenta desde el primer día con datos", () => {
    const r = resumenDeMes("2026-09", totales, "2026-09-21", "2026-12-31");
    expect(r).toMatchObject({ desde: "2026-09-21", dias: 10, total: 0, promedio: 0 });
  });

  it("un mes fuera del rango devuelve null", () => {
    expect(resumenDeMes("2026-08", totales, "2026-09-01", "2026-10-31")).toBeNull();
    expect(resumenDeMes("2026-11", totales, "2026-09-01", "2026-10-31")).toBeNull();
  });
});
