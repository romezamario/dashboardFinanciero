import { describe, expect, it } from "vitest";
import {
  coberturaPuesto,
  fallasRecientes,
  filaACorrida,
  huecosDeDatos,
  rejillaCorridas,
  rejillaDatos,
  resumirLecturas,
  type Corrida,
  type Resultado,
} from "./lecturas";
import type { DiaSalud } from "./salud";

const CDMX = () => -360;
const AHORA = new Date("2026-11-19T18:30:00Z"); // 12:30 en CDMX

function corrida(en: string, resultado: Resultado = "ok", extra: Partial<Corrida> = {}): Corrida {
  return filaACorrida({ subida_en: en, resultado, codigo: resultado === "ok" ? 0 : 2, utc_offset_min: -360, ...extra } as never);
}

describe("filaACorrida", () => {
  it("las filas anteriores al colector v5 (sin resultado) fueron buenas", () => {
    const c = filaACorrida({ subida_en: "2026-11-18T10:00:00Z", bateria_pct: 80 });
    expect(c.resultado).toBe("ok");
    expect(c.codigo).toBeNull();
    expect(c.bateria).toBe(80);
  });
});

describe("resumirLecturas", () => {
  it("bien si la última lectura buena fue hace menos de 2 h", () => {
    const r = resumirLecturas([corrida("2026-11-19T17:05:00Z", "ok", { ultimo_evento_unix: 1795600000 } as never)], AHORA);
    expect(r.estado).toBe("bien");
    expect(r.motivo).toContain("1 h");
    expect(r.datosHasta).toBe(1795600000);
    expect(r.conBitacora).toBe(true);
  });

  it("sin anillo: la laptop corre pero no lo encuentra", () => {
    const r = resumirLecturas(
      [corrida("2026-11-19T10:00:00Z"), corrida("2026-11-19T17:00:00Z", "sin_anillo"), corrida("2026-11-19T18:00:00Z", "sin_anillo")],
      AHORA,
    );
    expect(r.estado).toBe("sin_lecturas");
    expect(r.motivo).toMatch(/no encuentra el anillo/);
    expect(r.ultimas24).toEqual({ ok: 1, sin_anillo: 2, conexion_cortada: 0, error: 0 });
  });

  it("laptop apagada: la última corrida es vieja, sea cual sea su resultado", () => {
    const r = resumirLecturas([corrida("2026-11-19T15:00:00Z")], AHORA);
    expect(r.estado).toBe("atrasado");
    expect(r.motivo).toMatch(/no ha corrido el colector desde hace 4 h/);
  });

  it("error del colector con su mensaje", () => {
    const r = resumirLecturas([corrida("2026-11-19T18:00:00Z", "error", { mensaje: "RuntimeError: sin red" } as never)], AHORA);
    expect(r.estado).toBe("sin_lecturas");
    expect(r.motivo).toContain("RuntimeError: sin red");
    expect(r.horasSinOk).toBeNull();
  });

  it("sin corridas", () => {
    expect(resumirLecturas([], AHORA).estado).toBe("sin_datos");
  });
});

describe("fallasRecientes", () => {
  it("junta las fallas seguidas iguales y pone primero la más nueva", () => {
    const f = fallasRecientes([
      corrida("2026-11-19T01:00:00Z", "sin_anillo"),
      corrida("2026-11-19T02:00:00Z", "sin_anillo"),
      corrida("2026-11-19T03:00:00Z", "sin_anillo"),
      corrida("2026-11-19T04:00:00Z"),
      corrida("2026-11-19T05:00:00Z", "error", { mensaje: "x" } as never),
      corrida("2026-11-19T06:00:00Z", "sin_anillo"),
    ]);
    expect(f.map((x) => [x.resultado, x.veces])).toEqual([
      ["sin_anillo", 1],
      ["error", 1],
      ["sin_anillo", 3],
    ]);
    expect(f[2].desde).toBe("2026-11-19T01:00:00Z");
    expect(f[2].hasta).toBe("2026-11-19T03:00:00Z");
  });
});

describe("rejillaCorridas", () => {
  it("la mejor corrida de cada hora en la zona de la laptop; huecos y futuro", () => {
    const r = rejillaCorridas(
      [corrida("2026-11-19T15:10:00Z", "sin_anillo"), corrida("2026-11-19T15:40:00Z"), corrida("2026-11-19T16:10:00Z", "error")],
      ["2026-11-19"],
      AHORA,
      CDMX,
    );
    const dia = r.get("2026-11-19")!;
    expect(dia[9]).toBe("ok"); // 15:xx UTC = 09:xx CDMX
    expect(dia[10]).toBe("error");
    expect(dia[11]).toBe("sin_corrida");
    expect(dia[13]).toBe("futuro");
  });
});

describe("rejillaDatos y huecos", () => {
  // 2026-11-18 en CDMX empieza 06:00 UTC.
  const inicio = Date.parse("2026-11-18T06:00:00Z") / 1000;
  const eventos = Array.from({ length: 24 }, (_, h) => (h < 2 || h > 20 ? 0 : 100));
  const dia: DiaSalud = {
    fecha: "2026-11-18",
    utcOffset: -360,
    eventosHoras: eventos,
    tempHoras: [{ hora: 3, mediana: 35, n: 40 }],
    apagones: [{ inicio: inicio + 5 * 3600, fin: inicio + 8 * 3600 + 600, horas: 3.2 }],
  };

  it("puesto, quitado, apagado, sin datos, pendiente y futuro", () => {
    const datosHasta = Date.parse("2026-11-19T12:00:00Z") / 1000; // 06:00 CDMX del 19
    const r = rejillaDatos([dia], ["2026-11-18", "2026-11-19"], datosHasta, AHORA, CDMX);
    const d = r.get("2026-11-18")!;
    expect(d[0]).toBe("sin_datos");
    expect(d[3]).toBe("puesto");
    expect(d[4]).toBe("quitado");
    expect(d[5]).toBe("apagado");
    expect(d[8]).toBe("quitado"); // 10 min de apagón no tapan la hora
    const hoy = r.get("2026-11-19")!;
    expect(hoy[0]).toBe("sin_datos"); // día sin fila
    expect(hoy[6]).toBe("pendiente");
    expect(hoy[13]).toBe("futuro");

    const huecos = huecosDeDatos(r);
    // 21:00 del 18 → 05:59 del 19 sin datos (cruza la medianoche), el apagón de 3 h y 00–02 del 18.
    expect(huecos[0]).toEqual({ fecha: "2026-11-18", hora: 21, horas: 9, tipo: "sin_datos" });
    expect(huecos[1]).toEqual({ fecha: "2026-11-18", hora: 5, horas: 3, tipo: "apagado" });
    expect(huecos[2]).toEqual({ fecha: "2026-11-18", hora: 0, horas: 2, tipo: "sin_datos" });

    const c = coberturaPuesto(r);
    expect(c.puesto).toBe(1);
    expect(c.total).toBe(24 + 6);
  });

  it("un día de un colector anterior al v5 no se marca como hueco", () => {
    const viejo: DiaSalud = { fecha: "2026-11-10", tempHoras: [{ hora: 2, mediana: 35, n: 10 }] };
    const d = rejillaDatos([viejo], ["2026-11-10"], null, AHORA, CDMX).get("2026-11-10")!;
    expect(d[2]).toBe("puesto");
    expect(d[3]).toBe("sin_info");
    expect(huecosDeDatos(new Map([["2026-11-10", d]]))).toEqual([]);
  });
});
