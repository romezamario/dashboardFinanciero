import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cuerpoPreapproval,
  datosDelAviso,
  estadoDesdeMercadoPago,
  firmaValida,
  leerFirma,
  manifiestoFirma,
  periodoDesdeFrecuencia,
  planPorMonto,
  SITIOS_POR_DEFECTO,
  urlDeRegreso,
} from "./mercadopago.ts";

const PLANES = [
  { id: "gratis", precio_mensual: 0, precio_anual: 0 },
  { id: "basico", precio_mensual: 29, precio_anual: 290 },
  { id: "pro", precio_mensual: 59, precio_anual: 590 },
];

describe("firma de los avisos", () => {
  const secreto = "secreto-de-prueba";
  const firmar = (manifiesto: string) => createHmac("sha256", secreto).update(manifiesto).digest("hex");

  it("arma el manifiesto como lo documenta Mercado Pago (id en minúsculas)", () => {
    expect(manifiestoFirma("ABC123", "req-1", "1700000000")).toBe("id:abc123;request-id:req-1;ts:1700000000;");
    expect(manifiestoFirma(null, null, "1")).toBe("ts:1;");
  });

  it("lee ts y v1 de x-signature", () => {
    expect(leerFirma("ts=1700000000, v1=abcdef")).toEqual({ ts: "1700000000", v1: "abcdef" });
    expect(leerFirma("v1=abcdef")).toBeNull();
    expect(leerFirma(null)).toBeNull();
  });

  it("acepta la firma correcta y rechaza cualquier cambio", async () => {
    const v1 = firmar("id:2c938084;request-id:req-1;ts:1700000000;");
    const base = { cabeceraFirma: `ts=1700000000,v1=${v1}`, requestId: "req-1", dataId: "2c938084", secreto };
    expect(await firmaValida(base)).toBe(true);
    expect(await firmaValida({ ...base, dataId: "2c938085" })).toBe(false);
    expect(await firmaValida({ ...base, requestId: "req-2" })).toBe(false);
    expect(await firmaValida({ ...base, cabeceraFirma: `ts=1700000001,v1=${v1}` })).toBe(false);
    expect(await firmaValida({ ...base, secreto: "" })).toBe(false);
    expect(await firmaValida({ ...base, cabeceraFirma: null })).toBe(false);
  });
});

describe("avisos y estados", () => {
  it("toma tipo e id de la dirección o del cuerpo", () => {
    expect(datosDelAviso(new URL("https://x/f?type=subscription_preapproval&data.id=abc"), null)).toEqual({
      tipo: "subscription_preapproval",
      id: "abc",
    });
    expect(
      datosDelAviso(new URL("https://x/f"), { type: "subscription_authorized_payment", data: { id: 123 } })
    ).toEqual({ tipo: "subscription_authorized_payment", id: "123" });
    expect(datosDelAviso(new URL("https://x/f?topic=preapproval&id=9"), null)).toEqual({ tipo: "preapproval", id: "9" });
    expect(datosDelAviso(new URL("https://x/f"), { action: "x" })).toBeNull();
  });

  it("traduce los estados de Mercado Pago", () => {
    expect(estadoDesdeMercadoPago("authorized")).toBe("activa");
    expect(estadoDesdeMercadoPago("pending")).toBe("pendiente");
    expect(estadoDesdeMercadoPago("paused")).toBe("pausada");
    expect(estadoDesdeMercadoPago("cancelled")).toBe("cancelada");
    expect(estadoDesdeMercadoPago("otro")).toBeNull();
  });

  it("reconoce el plan por monto y periodo", () => {
    expect(periodoDesdeFrecuencia(12, "months")).toBe("anual");
    expect(periodoDesdeFrecuencia(1, "months")).toBe("mensual");
    expect(periodoDesdeFrecuencia(1, "days")).toBeNull();
    expect(planPorMonto(PLANES, 290, "anual")).toBe("basico");
    expect(planPorMonto(PLANES, 59, "mensual")).toBe("pro");
    expect(planPorMonto(PLANES, 0, "mensual")).toBeNull();
    expect(planPorMonto(PLANES, 30, "mensual")).toBeNull();
  });
});

describe("alta de la suscripción", () => {
  it("regresa al sitio de origen solo si es uno permitido", () => {
    expect(urlDeRegreso("https://pruebas.ordenatulana.pages.dev", SITIOS_POR_DEFECTO)).toBe(
      "https://pruebas.ordenatulana.pages.dev/?pago=mercadopago"
    );
    expect(urlDeRegreso("https://malo.example", SITIOS_POR_DEFECTO)).toBe("https://ordenatulana.com/?pago=mercadopago");
    expect(urlDeRegreso(null, SITIOS_POR_DEFECTO)).toBe("https://ordenatulana.com/?pago=mercadopago");
  });

  it("cobra cada 12 meses el anual y lleva el usuario como referencia", () => {
    const cuerpo = cuerpoPreapproval({
      plan: "basico",
      periodo: "anual",
      monto: 290,
      userId: "u-1",
      correo: "c@x.mx",
      urlRegreso: "https://ordenatulana.com/?pago=mercadopago",
    });
    expect(cuerpo.auto_recurring).toEqual({
      frequency: 12,
      frequency_type: "months",
      transaction_amount: 290,
      currency_id: "MXN",
    });
    expect(cuerpo.external_reference).toBe("u-1");
    expect(cuerpo.status).toBe("pending");
    expect(cuerpo.reason).toBe("Ordena tu Lana · Plan Básico anual");
  });
});
