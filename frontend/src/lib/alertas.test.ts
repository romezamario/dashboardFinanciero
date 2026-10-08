import { describe, expect, it } from "vitest";
import { detectarCambiosDePrecio, detectarDuplicados, detectarSuscripcionesNuevas } from "./alertas";
import { resolverPeriodo } from "./indicadores";
import { transaccion } from "../test/fabrica";

const agosto = resolverPeriodo({ desde: "2026-08", hasta: "2026-08" });

describe("detectarDuplicados", () => {
  it("misma cuenta, comercio, monto y día", () => {
    const alertas = detectarDuplicados(
      [
        transaccion({ comercio: "Netflix", monto: 299 }),
        transaccion({ comercio: "Netflix", monto: 299 }),
        transaccion({ comercio: "Netflix", monto: 299, cuenta: "Invex TDC" }),
      ],
      agosto
    );
    expect(alertas).toHaveLength(1);
    expect(alertas[0].tono).toBe("revisar");
  });

  it("ignora los cargos de $0 (eco de Invex V2)", () => {
    const alertas = detectarDuplicados(
      [transaccion({ monto: 0 }), transaccion({ monto: 0 })],
      agosto
    );
    expect(alertas).toEqual([]);
  });
});

describe("detectarCambiosDePrecio", () => {
  const cobro = (fecha: string, monto: number) => transaccion({ comercio: "Netflix", fecha, monto });

  it("dos cobros iguales y luego uno distinto dentro del periodo", () => {
    const alertas = detectarCambiosDePrecio(
      [cobro("2026-06-05", 299), cobro("2026-07-05", 299), cobro("2026-08-05", 329)],
      agosto
    );
    expect(alertas.map((a) => a.titulo)).toEqual(["Netflix subió de precio"]);
  });

  it("un salto de más del 50% es otra compra, no un cambio de precio", () => {
    const alertas = detectarCambiosDePrecio(
      [cobro("2026-06-05", 299), cobro("2026-07-05", 299), cobro("2026-08-05", 999)],
      agosto
    );
    expect(alertas).toEqual([]);
  });

  it("un mes con varios cargos del comercio no cuenta como precio", () => {
    const alertas = detectarCambiosDePrecio(
      [
        cobro("2026-06-05", 299),
        cobro("2026-07-05", 299),
        cobro("2026-08-05", 329),
        cobro("2026-08-20", 50),
      ],
      agosto
    );
    expect(alertas).toEqual([]);
  });
});

describe("detectarSuscripcionesNuevas", () => {
  it("comercio nuevo con dos cobros mensuales iguales", () => {
    const alertas = detectarSuscripcionesNuevas(
      [
        transaccion({ comercio: "Spotify", fecha: "2026-07-10", monto: 129 }),
        transaccion({ comercio: "Spotify", fecha: "2026-08-10", monto: 129 }),
      ],
      agosto
    );
    expect(alertas.map((a) => a.tipo)).toEqual(["suscripcion-nueva"]);
  });

  it("con historial viejo ya no es nueva", () => {
    const alertas = detectarSuscripcionesNuevas(
      [
        transaccion({ comercio: "Spotify", fecha: "2025-01-10", monto: 129 }),
        transaccion({ comercio: "Spotify", fecha: "2026-07-10", monto: 129 }),
        transaccion({ comercio: "Spotify", fecha: "2026-08-10", monto: 129 }),
      ],
      agosto
    );
    expect(alertas).toEqual([]);
  });
});
