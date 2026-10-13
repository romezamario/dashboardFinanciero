import { describe, expect, it } from "vitest";
import {
  describirPlan,
  diasHasta,
  pagoConfirmado,
  suscripcionViva,
  type Suscripcion,
} from "./suscripcion";
import { leerRegresoDePago, urlSinRegresoDePago } from "./regresoPago";

const suscripcion = (cambios: Partial<Suscripcion>): Suscripcion => ({
  id: "s",
  plan_id: "basico",
  periodo: "mensual",
  monto: 29,
  estado: "activa",
  proveedor: "mercadopago",
  proveedor_id: "mp-1",
  periodo_fin: null,
  ultimo_cobro_en: null,
  ultimo_cobro_estado: null,
  creado_en: "2026-10-13T00:00:00Z",
  ...cambios,
});

describe("regreso de Mercado Pago", () => {
  it("reconoce el regreso y quita sus parámetros de la dirección", () => {
    expect(leerRegresoDePago("?pago=mercadopago&preapproval_id=abc")).toEqual({ preapprovalId: "abc" });
    expect(leerRegresoDePago("?pago=mercadopago")).toEqual({ preapprovalId: null });
    expect(leerRegresoDePago("?token_hash=x")).toBeNull();
    expect(urlSinRegresoDePago("https://a.mx/?pago=mercadopago&preapproval_id=abc&x=1#entrar")).toBe("/?x=1#entrar");
    expect(urlSinRegresoDePago("https://a.mx/?pago=mercadopago&preapproval_id=abc")).toBe("/");
  });
});

describe("plan del cliente", () => {
  const ahora = new Date("2026-10-13T12:00:00Z");

  it("cuenta los días de prueba que quedan", () => {
    expect(diasHasta("2026-10-20T12:00:00Z", ahora)).toBe(7);
    expect(diasHasta("2026-10-01T00:00:00Z", ahora)).toBe(0);
    expect(describirPlan({ plan_id: "basico", origen: "prueba", vigente_hasta: "2026-10-14T11:00:00Z", periodo: null }, ahora)).toBe(
      "Prueba gratis de Básico: te queda 1 día."
    );
  });

  it("describe una suscripción activa y una cancelada con periodo pagado", () => {
    expect(describirPlan({ plan_id: "pro", origen: "suscripcion", vigente_hasta: null, periodo: "anual" }, ahora)).toBe(
      "Plan Pro anual."
    );
    expect(
      describirPlan({ plan_id: "pro", origen: "suscripcion", vigente_hasta: "2026-11-05T00:00:00Z", periodo: "mensual" }, ahora)
    ).toMatch(/^Plan Pro mensual cancelado: ya no se te cobrará\. Lo sigues usando hasta el .*; después pasas al plan Gratis\.$/);
    expect(describirPlan({ plan_id: "gratis", origen: "gratis", vigente_hasta: null, periodo: null }, ahora)).toBe("Plan Gratis.");
  });

  it("encuentra la suscripción que cobra y confirma el pago del regreso", () => {
    const lista = [suscripcion({ id: "a", estado: "pendiente", proveedor_id: "mp-2" }), suscripcion({ id: "b" })];
    expect(suscripcionViva(lista)?.id).toBe("b");
    expect(suscripcionViva([suscripcion({ estado: "cancelada" })])).toBeNull();
    expect(pagoConfirmado(lista, "mp-1")).toBe(true);
    expect(pagoConfirmado(lista, "mp-2")).toBe(false);
  });
});
