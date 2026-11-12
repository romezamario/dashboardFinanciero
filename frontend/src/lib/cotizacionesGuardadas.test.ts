import { afterEach, describe, expect, it, vi } from "vitest";
import { cotizacionesGuardadas, obtenerCotizaciones, type SerieCotizaciones } from "./tecnico";

function almacenFalso(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    datos,
  };
}

const serie: SerieCotizaciones = {
  simbolo: "QQQ",
  nombre: "Invesco QQQ",
  actualizado: "2026-11-11T21:00:00Z",
  velas: [{ fecha: "2026-11-11", apertura: 1, maximo: 2, minimo: 0.5, cierre: 1.5, volumen: 10 }],
};

afterEach(() => vi.unstubAllGlobals());

describe("cotizacionesGuardadas", () => {
  it("guarda lo descargado y lo devuelve en la siguiente visita", async () => {
    const almacen = almacenFalso();
    vi.stubGlobal("localStorage", almacen);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(serie)));
    await obtenerCotizaciones("QQQ", true);
    expect(cotizacionesGuardadas(["QQQ", "TQQQ"])).toEqual({ QQQ: serie });
  });

  it("ignora datos corruptos, de otro símbolo o sin velas", () => {
    vi.stubGlobal(
      "localStorage",
      almacenFalso({
        "cotizaciones:QQQ": "{no es json",
        "cotizaciones:TQQQ": JSON.stringify({ ...serie, simbolo: "QQQ" }),
      })
    );
    expect(cotizacionesGuardadas(["QQQ", "TQQQ"])).toEqual({});
  });

  it("sin almacenamiento (ventana privada) no falla", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
    });
    expect(cotizacionesGuardadas(["QQQ"])).toEqual({});
  });
});
