import { describe, expect, it } from "vitest";
import {
  comentarioDeFaltantes,
  describirBonificacion,
  felicitacion,
  muestraParaBanco,
  pareceDatoReal,
  type Bonificacion,
  type MuestraPorConfirmar,
} from "./muestras";

const ahora = new Date("2026-10-15T12:00:00Z");
const bono = (cambios: Partial<Bonificacion>): Bonificacion => ({
  id: "b",
  plan_id: "pro",
  meses: 1,
  desde: "2026-10-15T12:00:00Z",
  hasta: "2026-11-15T12:00:00Z",
  creado_en: "2026-10-15T12:00:00Z",
  ...cambios,
});

describe("recompensa por muestras", () => {
  it("arma el comentario de lo que falta sin datos reales", () => {
    expect(comentarioDeFaltantes(["Compras a meses sin intereses"], " 3 ", "las de la tarjeta digital")).toBe(
      "Faltan: Compras a meses sin intereses. Aprox. 3 movimiento(s) faltante(s). Detalle: las de la tarjeta digital"
    );
    expect(comentarioDeFaltantes([], "muchos", "")).toBe("");
    expect(comentarioDeFaltantes([], "", "x".repeat(900))).toHaveLength(500);
  });

  it("detecta montos, cuentas y correos en el detalle", () => {
    expect(pareceDatoReal("un cargo de $350")).toBe(true);
    expect(pareceDatoReal("cargo 1,250.00 de Oxxo")).toBe(true);
    expect(pareceDatoReal("a la cuenta 012345678901234567")).toBe(true);
    expect(pareceDatoReal("me escribió ana@correo.mx")).toBe(true);
    expect(pareceDatoReal("faltan las compras a 12 meses del día 5")).toBe(false);
  });

  it("elige la muestra pendiente del banco que se acaba de leer", () => {
    const m = (id: string, banco_lector: string | null): MuestraPorConfirmar => ({
      id,
      banco_lector,
      banco_detectado: null,
      mensaje_cliente: null,
      recompensa: true,
    });
    expect(muestraParaBanco([m("a", "BBVA"), m("b", "Banamex")], "banamex")?.id).toBe("b");
    expect(muestraParaBanco([m("a", "BBVA")], "Invex TDC")).toBeNull();
    expect(muestraParaBanco([m("a", null)], "Invex TDC")?.id).toBe("a");
  });

  it("describe cada bonificación según su momento", () => {
    expect(describirBonificacion(bono({}), ahora)).toMatch(/^1 mes de Pro gratis: vigente hasta el /);
    expect(describirBonificacion(bono({ plan_id: "basico", meses: 2, desde: null, hasta: null }), ahora)).toBe(
      "2 meses de Básico gratis, a favor: se aplica cuando termine tu suscripción."
    );
    expect(describirBonificacion(bono({ desde: "2026-11-01T00:00:00Z", hasta: "2026-12-01T00:00:00Z" }), ahora)).toMatch(
      /empieza el/
    );
    expect(describirBonificacion(bono({ desde: "2026-08-01T00:00:00Z", hasta: "2026-09-01T00:00:00Z" }), ahora)).toMatch(
      /ya usado/
    );
  });

  it("felicita con la bonificación o solo agradece", () => {
    expect(felicitacion(bono({}), ahora)).toMatch(/^¡Felicidades!.*Te regalamos 1 mes de Pro gratis/);
    expect(felicitacion(null, ahora)).toMatch(/^¡Gracias/);
  });
});
