import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import { avisoColector, fechaLocal, VERSION_COLECTOR_ESPERADA, zonaPorDia, textoZona, type EstadoColector } from "./colector";
import type { DiaEstres } from "./indicadores";
import { fraseRelacion, MINIMO_PARES, paresDe, pearson, relacion, RELACIONES } from "./relaciones";
import type { DiaSalud, Noche } from "./salud";
import { lunesDe, resumenSemanal, semanaParaResumir, semanasConDatos } from "./semanal";
import { efectoViaje, fechasDeViaje, porcentajeEstres, problemaViaje, tramosFueraDeCasa, tramosSinMarcar, veredicto, type Viaje } from "./viajes";

const noche = (fecha: string, n: Partial<Noche> = {}): DiaSalud => ({
  fecha,
  noche: { hrv_ms: 50, rhr: 55, skin_temp: 35, breath_rate: 15, start: "23:00", end: "07:00", metrics: { asleep_min: 450 }, ...n },
});
const estresDia = (fecha: string, estres: number, normal = 240 - estres): DiaEstres => ({
  fecha,
  puntos: [],
  minutos: { estres, normal, recuperacion: 0, movimiento: 0 },
  normal: { lpm: 80, rmssd: 30, ventanas: 40 },
});
const fecha = (i: number) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);

describe("aviso del colector", () => {
  const base: EstadoColector = { subidaEn: "2026-11-14T15:00:00Z", version: VERSION_COLECTOR_ESPERADA, commit: "abc1234def", alDia: true, error: null };
  it("no avisa si está al día", () => expect(avisoColector(base)).toBeNull());
  it("avisa si la versión es vieja o falta", () => {
    expect(avisoColector({ ...base, version: null })?.titulo).toMatch(/desactualizado/);
    expect(avisoColector({ ...base, version: VERSION_COLECTOR_ESPERADA - 1, error: "sin red" })?.detalle).toMatch(/sin red/);
  });
  it("avisa si no pudo actualizarse", () => expect(avisoColector({ ...base, alDia: false, error: "pruebas" })?.titulo).toMatch(/no pudo/));
  it("sin datos no avisa", () => expect(avisoColector(null)).toBeNull());
});

describe("zona por día", () => {
  it("usa la fecha local y la zona más frecuente", () => {
    expect(fechaLocal("2026-11-14T05:00:00Z", -480)).toBe("2026-11-13");
    const z = zonaPorDia([
      { subidaEn: "2026-11-12T14:00:00Z", offset: -360 },
      { subidaEn: "2026-11-12T20:00:00Z", offset: -480 },
      { subidaEn: "2026-11-12T21:00:00Z", offset: -480 },
      { subidaEn: "2026-11-13T18:00:00Z", offset: -480 },
    ]);
    expect([...z]).toEqual([["2026-11-12", -480], ["2026-11-13", -480]]);
    expect(textoZona(-480)).toBe("UTC−8");
    expect(textoZona(330)).toBe("UTC+5.5");
  });
});

describe("viajes", () => {
  it("junta días fuera de casa y tolera un hueco", () => {
    const z = new Map([["2026-11-10", -360], ["2026-11-12", -480], ["2026-11-13", -480], ["2026-11-15", -480], ["2026-11-20", -480]]);
    const t = tramosFueraDeCasa(z);
    expect(t).toEqual([{ desde: "2026-11-12", hasta: "2026-11-15", offset: -480 }, { desde: "2026-11-20", hasta: "2026-11-20", offset: -480 }]);
    const v: Viaje = { id: 1, lugar: "Las Vegas", desde: "2026-11-12", hasta: null, offset: null };
    expect(tramosSinMarcar(t, [v], "2026-11-16")).toEqual([t[1]]);
  });
  it("valida y lista fechas", () => {
    expect(problemaViaje({ lugar: " ", desde: "2026-11-12", hasta: null })).toMatch(/lugar/);
    expect(problemaViaje({ lugar: "LV", desde: "2026-11-12", hasta: "2026-11-11" })).toMatch(/regreso/);
    expect(problemaViaje({ lugar: "LV", desde: "2026-11-12", hasta: null })).toBeNull();
    expect([...fechasDeViaje([{ id: 1, lugar: "LV", desde: "2026-11-12", hasta: null, offset: null }], "2026-11-14")]).toEqual([
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
    ]);
  });
  it("compara antes, durante y después", () => {
    const dias = [
      ...Array.from({ length: 14 }, (_, i) => noche(fecha(i))),
      noche(fecha(14), { metrics: { asleep_min: 360 }, hrv_ms: 40, start: "01:00" }),
      noche(fecha(15), { metrics: { asleep_min: 360 }, hrv_ms: 40, start: "01:00" }),
      noche(fecha(16)),
    ];
    const v: Viaje = { id: 1, lugar: "Las Vegas", desde: fecha(14), hasta: fecha(15), offset: null };
    const e = efectoViaje(dias, [], v, fecha(20), new Map([[fecha(14), -480]]));
    const sueno = e.filas.find((f) => f.clave === "sueno")!;
    expect(sueno.antes.valor).toBe(450);
    expect(sueno.durante.valor).toBe(360);
    expect(sueno.despues).toEqual({ valor: 450, n: 1 });
    expect(veredicto("sueno", true, sueno.antes, sueno.durante)).toBe("peor");
    const dormir = e.filas.find((f) => f.clave === "dormir")!;
    expect((dormir.durante.valor as number) - (dormir.antes.valor as number)).toBe(120);
    expect(e.cambioHoras).toBe(-2);
    expect(e.enCurso).toBe(false);
  });
  it("% de estrés solo con 2 h juzgadas", () => {
    expect([...porcentajeEstres([estresDia("2026-11-10", 60), estresDia("2026-11-11", 15, 60)])]).toEqual([["2026-11-10", 25]]);
  });
});

describe("resumen semanal", () => {
  it("elige la semana de lunes a domingo", () => {
    expect(lunesDe("2026-11-15")).toBe("2026-11-09"); // domingo
    expect(lunesDe("2026-11-09")).toBe("2026-11-09");
    expect(semanaParaResumir("2026-11-15")).toBe("2026-11-09"); // domingo: esta semana
    expect(semanaParaResumir("2026-11-14")).toBe("2026-11-02"); // sábado: la anterior
  });
  it("dice qué mejoró y qué empeoró", () => {
    // Semana 1: 2–8 nov (7 h 30), semana 2: 9–15 nov (6 h, HRV más alta).
    const dias = [
      ...Array.from({ length: 7 }, (_, i) => noche(fecha(1 + i))),
      ...Array.from({ length: 7 }, (_, i) => noche(fecha(8 + i), { metrics: { asleep_min: 360 }, hrv_ms: 60 })),
    ];
    const estres = [
      ...Array.from({ length: 7 }, (_, i) => estresDia(fecha(1 + i), 24)),
      ...Array.from({ length: 7 }, (_, i) => estresDia(fecha(8 + i), 24)),
    ];
    const r = resumenSemanal(dias, estres, "2026-11-09");
    const v = Object.fromEntries(r.cambios.map((c) => [c.clave, c.veredicto]));
    expect(v.sueno).toBe("peor");
    expect(v.hrv).toBe("mejor");
    expect(v.estres).toBe("igual");
    expect(r.noches).toBe(7);
    expect(semanasConDatos(dias)).toEqual(["2026-11-02", "2026-11-09"]);
  });
  it("sin semana anterior no compara", () => {
    const r = resumenSemanal([noche("2026-11-10"), noche("2026-11-11"), noche("2026-11-12")], [], "2026-11-09");
    expect(r.cambios.every((c) => c.veredicto === "sin-dato")).toBe(true);
  });
});

describe("relaciones", () => {
  it("pearson y mitades", () => {
    const pares = [1, 2, 3, 4, 5, 6].map((x, i) => ({ fecha: fecha(i), x, y: 100 - 10 * x }));
    expect(pearson(pares)).toBeCloseTo(-1);
    const r = relacion(pares);
    expect(r.fuerza).toBe("fuerte");
    expect(r.pendiente).toBeCloseTo(-10);
    expect(r.yMitadAlta! - r.yMitadBaja!).toBeCloseTo(-30);
    expect(fraseRelacion(RELACIONES[0], r)).toMatch(/^En los días de más estrés tuviste 30 min de sueño menos/);
    expect(fraseRelacion(RELACIONES[0], relacion(pares.slice(0, MINIMO_PARES - 1)))).toMatch(/Hacen falta/);
  });
  it("arma pares con la noche siguiente y excluye viajes", () => {
    const dias = [noche("2026-11-10"), noche("2026-11-11", { metrics: { asleep_min: 300 } }), noche("2026-11-12")];
    const estres = [estresDia("2026-11-10", 120), estresDia("2026-11-11", 24)];
    expect(paresDe("estres-sueno", dias, estres)).toEqual([
      { fecha: "2026-11-10", x: 50, y: 300 },
      { fecha: "2026-11-11", x: 10, y: 450 },
    ]);
    expect(paresDe("estres-sueno", dias, estres, new Set(["2026-11-12"]))).toHaveLength(1);
    expect(paresDe("sueno-estres", dias, estres)[0]).toEqual({ fecha: "2026-11-10", x: 450, y: 50 });
    expect(paresDe("dormir-hrv", dias, estres)[0]).toEqual({ fecha: "2026-11-10", x: 300, y: 50 });
  });
});
