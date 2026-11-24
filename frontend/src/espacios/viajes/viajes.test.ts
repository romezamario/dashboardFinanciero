import { describe, expect, it } from "vitest";
import {
  alojamientoDeNoche,
  clasificarViajes,
  cuentaRegresiva,
  enlaceBitacora,
  fechasDelViaje,
  formatoMonto,
  gastoPrevisto,
  hoyIso,
  nochesSinAlojamiento,
  normalizarViajes,
  pendientesDeLista,
  planDelDia,
  proximosTickets,
  rangoFechas,
  resumenDelAnio,
  type Viaje,
} from "./viajes";

function viaje(parcial: Partial<Viaje> & { id?: string } = {}): Viaje {
  return normalizarViajes({ [parcial.id ?? "v1"]: { name: "Viaje", start: "2026-12-03", end: "2026-12-06", ...parcial } })[0];
}

describe("normalizarViajes", () => {
  it("descarta lo que no es un viaje y completa las listas", () => {
    const l = normalizarViajes({
      a: { name: " Japón ", start: "2027-03-01", end: "2027-03-10" },
      b: { name: "" },
      c: null,
      d: [1, 2],
      e: { name: "Sin fechas", start: "mañana", lodging: "x", days: [] },
    });
    expect(l.map((v) => v.id)).toEqual(["a", "e"]);
    expect(l[0].name).toBe("Japón");
    expect(l[0].lodging).toEqual([]);
    expect(l[1].start).toBeUndefined();
    expect(l[1].days).toEqual({});
  });

  it("sin fecha de vuelta usa la de ida", () => {
    expect(normalizarViajes({ a: { name: "x", start: "2027-01-01" } })[0].end).toBe("2027-01-01");
  });
});

describe("fechas y estado", () => {
  it("hoyIso usa la fecha local", () => {
    expect(hoyIso(new Date(2026, 10, 23, 23, 30))).toBe("2026-11-23");
  });

  it("lista las fechas del viaje, cruzando meses", () => {
    expect(fechasDelViaje(viaje({ start: "2026-12-30", end: "2027-01-02" }))).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("cuenta regresiva en cada estado", () => {
    const v = viaje();
    expect(cuentaRegresiva(v, "2026-12-02")).toBe("Sale mañana");
    expect(cuentaRegresiva(v, "2026-11-23")).toBe("Faltan 10 días");
    expect(cuentaRegresiva(v, "2026-12-03")).toBe("Día 1 de 4");
    expect(cuentaRegresiva(v, "2026-12-06")).toBe("Día 4 de 4");
    expect(cuentaRegresiva(v, "2026-12-07")).toBe("Terminó ayer");
    expect(cuentaRegresiva(v, "2026-12-16")).toBe("Terminó hace 10 días");
    expect(cuentaRegresiva(viaje({ start: undefined }), "2026-12-01")).toBe("Sin fechas");
  });

  it("clasifica y ordena", () => {
    const l = normalizarViajes({
      lejos: { name: "Lejos", start: "2027-05-01", end: "2027-05-03" },
      cerca: { name: "Cerca", start: "2026-12-01", end: "2026-12-02" },
      ahora: { name: "Ahora", start: "2026-11-20", end: "2026-11-25" },
      viejo: { name: "Viejo", start: "2025-01-01", end: "2025-01-05" },
      reciente: { name: "Reciente", start: "2026-10-01", end: "2026-10-05" },
      nada: { name: "Idea" },
    });
    const c = clasificarViajes(l, "2026-11-23");
    expect(c.enCurso.map((v) => v.id)).toEqual(["ahora"]);
    expect(c.proximos.map((v) => v.id)).toEqual(["cerca", "lejos"]);
    expect(c.pasados.map((v) => v.id)).toEqual(["reciente", "viejo"]);
    expect(c.sinFechas.map((v) => v.id)).toEqual(["nada"]);
  });
});

describe("contenido del viaje", () => {
  const v = viaje({
    currency: "EUR",
    lodging: [
      { name: "Hotel A", checkIn: "2026-12-03", checkOut: "2026-12-05", price: "300" },
      { name: "Sin fechas", price: 50 },
    ],
    tickets: [
      { title: "Vuelo vuelta", date: "2026-12-06", time: "18:00", price: 200 },
      { title: "Vuelo ida", date: "2026-12-03", time: "07:30", price: "180.5" },
      { title: "Museo", date: "2026-12-04", time: "10:00" },
      { title: "Sin fecha" },
    ],
    days: {
      "2026-12-04": { title: "Centro", places: [{ name: "Cena", time: "21:00", cost: 40 }, { name: "Mercado", time: "09:00" }, { name: "Paseo" }] },
    },
    checklist: [{ text: "Pasaporte", done: true }, { text: "Adaptador" }],
  });

  it("gasto previsto suma alojamientos, tickets y lugares", () => {
    expect(gastoPrevisto(v)).toBe(300 + 50 + 200 + 180.5 + 40);
  });

  it("alojamiento por noche y noches sin alojamiento", () => {
    expect(alojamientoDeNoche(v, "2026-12-04")?.name).toBe("Hotel A");
    expect(alojamientoDeNoche(v, "2026-12-05")).toBeUndefined();
    // Noches del 3, 4 y 5; la del 6 es el regreso.
    expect(nochesSinAlojamiento(v)).toEqual(["2026-12-05"]);
  });

  it("próximos tickets en orden y desde hoy", () => {
    expect(proximosTickets(v, "2026-12-01").map((k) => k.title)).toEqual(["Vuelo ida", "Museo", "Vuelo vuelta"]);
    expect(proximosTickets(v, "2026-12-04", 5).map((k) => k.title)).toEqual(["Museo", "Vuelo vuelta"]);
  });

  it("plan del día con lugares por hora (sin hora al final)", () => {
    const p = planDelDia(v, "2026-12-04");
    expect(p.titulo).toBe("Centro");
    expect(p.lugares.map((l) => l.name)).toEqual(["Mercado", "Cena", "Paseo"]);
    expect(p.tickets.map((k) => k.title)).toEqual(["Museo"]);
    expect(p.alojamiento?.name).toBe("Hotel A");
  });

  it("pendientes de la lista", () => {
    expect(pendientesDeLista(v)).toBe(1);
  });
});

describe("resumen y formato", () => {
  it("cuenta días del año sin duplicar los que se traslapan", () => {
    const l = normalizarViajes({
      a: { name: "a", start: "2026-12-30", end: "2027-01-02" },
      b: { name: "b", start: "2026-12-31", end: "2026-12-31" },
      c: { name: "c", start: "2027-03-01", end: "2027-03-03" },
    });
    expect(resumenDelAnio(l, 2026)).toEqual({ viajes: 2, dias: 2 });
    expect(resumenDelAnio(l, 2027)).toEqual({ viajes: 2, dias: 5 });
  });

  it("rango de fechas", () => {
    expect(rangoFechas(viaje())).toBe("3 – 6 dic 2026");
    expect(rangoFechas(viaje({ start: "2026-12-28", end: "2027-01-04" }))).toMatch(/^28 dic.* – 4 ene 2027$/);
    expect(rangoFechas(viaje({ start: "2027-02-27", end: "2027-03-02" }))).toBe("27 feb – 2 mar 2027");
  });

  it("monto con moneda inválida no truena", () => {
    expect(formatoMonto(1500, "eur")).toContain("1,500");
    expect(formatoMonto(1500, "pesos")).toBe("1,500 PESOS");
  });

  it("liga a la bitácora", () => {
    expect(enlaceBitacora("https://x.pages.dev/", "a b")).toBe("https://x.pages.dev/#viaje=a%20b");
    expect(enlaceBitacora("https://x.pages.dev")).toBe("https://x.pages.dev/");
  });
});
