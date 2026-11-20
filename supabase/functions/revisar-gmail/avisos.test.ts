import { describe, expect, it } from "vitest";
import {
  aFila,
  ciudadDe,
  ciudadesValidas,
  clasificar,
  esDebito,
  htmlDelMensaje,
  parsearAviso,
  reglasValidas,
  textosDelHtml,
  titulo,
  type Regla,
} from "./avisos.ts";

// Mismos HTML sintéticos que tests/test_gmail_gastos.py (estructura del aviso
// real, datos inventados: nunca se versionan correos reales).
const P = (t: string) => `<p style='x'>\n\t\t\t\t\t${t}\n\t\t\t\t</p>`;
const fila = (etiqueta: string, valor: string) => `<tr><td>${P(etiqueta)}</td><td></td><td><p><b>${valor}</b></p></td></tr>`;

function avisoHtml({
  monto = "$ 14.81",
  establecimiento = "TIENDA DEMO  CENTRO  MCA",
  fecha = "03 Octubre 2026 / 13:22:26",
  estatus = "Exitoso",
  tarjetaHtml = "BEYOND BANAMEX\n\t\t&nbsp;Adicional&nbsp;\n\t\t179",
  operacion = "Retiro / Compra",
} = {}) {
  return (
    "<html><body><table><tr><td><p><b>Se realiz&oacute; la siguiente operaci&oacute;n: " +
    `${operacion}<br></b></p><p>NOMBRE DEMO <br></p></td></tr>` +
    `<tr><td><b>${tarjetaHtml}</b></td></tr>` +
    "<tr><td><b>Detalle de la operaci&oacute;n</b></td></tr>" +
    fila("Monto", monto) +
    fila("Establecimiento", establecimiento) +
    fila("Fecha y hora", fecha) +
    fila("Estatus", `\n\t\t\t\t${estatus}\n\t\t\t`) +
    fila("No. Autorizaci&oacute;n", "123456") +
    "</table></body></html>"
  );
}

function debitoHtml(monto = "$ 1,500.00 M.N.", fecha = "05 Octubre 2026 / 10:15:00") {
  return (
    "<html><body><table><tr><td><p><b>Se realiz&oacute; la siguiente operaci&oacute;n: " +
    "Retiro/Compra<br></b></p><p>NOMBRE DEMO <br></p></td></tr>" +
    "<tr><td><b>Cheques M.N. ***123</b></td></tr>" +
    "<tr><td><b>Detalle de la operaci&oacute;n</b></td></tr>" +
    fila("Monto", monto) +
    fila("Fecha y hora", fecha) +
    fila("Estatus", "Exitoso") +
    "</table></body></html>"
  );
}

const REGLAS: Regla[] = [
  { patron: "TIENDA DEMO", categoria: "Compras", comercio: "Demo" },
  { patron: "GAS", categoria: "Transporte", comercio: "Gasolinera" },
];

describe("parsearAviso", () => {
  it("tarjeta adicional con hora de 24 h", () => {
    expect(parsearAviso(avisoHtml(), "m1")).toEqual({
      id: "m1",
      fecha: "2026-10-03",
      hora: "13:22",
      tarjeta: "179",
      establecimiento: "TIENDA DEMO CENTRO MCA",
      centavos: 1481,
    });
  });

  it("tarjeta titular con hora de 12 h", () => {
    const pm = parsearAviso(avisoHtml({ tarjetaHtml: "BEYOND BANAMEX**904", monto: "$148.26", fecha: "2026/10/3 05:04:16 PM" }), "m2")!;
    expect([pm.tarjeta, pm.fecha, pm.hora, pm.centavos]).toEqual(["904", "2026-10-03", "17:04", 14826]);
    expect(parsearAviso(avisoHtml({ tarjetaHtml: "BEYOND BANAMEX**904", fecha: "2026/10/3 12:01:01 PM" }), "m")!.hora).toBe("12:01");
    expect(parsearAviso(avisoHtml({ tarjetaHtml: "BEYOND BANAMEX**904", fecha: "2026/10/3 12:05:00 AM" }), "m")!.hora).toBe("00:05");
  });

  it("monto con miles y código pegado al nombre", () => {
    expect(parsearAviso(avisoHtml({ monto: "$ 2,769.06" }), "m")!.centavos).toBe(276906);
    expect(parsearAviso(avisoHtml({ establecimiento: "BATH AND BODY WORKS#55MCA" }), "m")!.establecimiento).toBe(
      "BATH AND BODY WORKS#55MCA"
    );
  });

  it("el aviso de débito se reconoce aparte", () => {
    expect(parsearAviso(debitoHtml(), "d")).toBeNull();
    expect(esDebito(debitoHtml())).toBe(true);
    expect(esDebito(debitoHtml().replace("Cheques M.N. ***123", "CTA PRIORITY BNM M.N. ***123"))).toBe(true);
    expect(esDebito(avisoHtml())).toBe(false);
  });

  it("lo que no es un cargo exitoso legible devuelve null en vez de adivinar", () => {
    expect(parsearAviso(avisoHtml({ estatus: "Rechazado" }), "m")).toBeNull();
    expect(parsearAviso(avisoHtml({ operacion: "Pago de tarjeta" }), "m")).toBeNull();
    expect(parsearAviso(avisoHtml({ monto: "sin monto" }), "m")).toBeNull();
    expect(parsearAviso(avisoHtml({ fecha: "ayer" }), "m")).toBeNull();
    expect(parsearAviso(avisoHtml({ fecha: "03 Brumario 2026 / 10:00:00" }), "m")).toBeNull();
    expect(parsearAviso(avisoHtml({ tarjetaHtml: "TARJETA SIN TERMINACION" }), "m")).toBeNull();
    expect(parsearAviso("<html><body>hola</body></html>", "m")).toBeNull();
  });

  it("los textos salen sin entidades ni comentarios", () => {
    expect(textosDelHtml("<p>Se realiz&oacute;&nbsp; <!-- x -->ya</p><b>A&amp;B &#209;</b>")).toEqual(["Se realizó ya", "A&B Ñ"]);
  });
});

describe("ciudad, categoría y comercio", () => {
  it("códigos confirmados, sin confirmar y de país", () => {
    expect(ciudadDe("MACYS LA PLAZA MALL MCA")).toEqual(["MCA", "McAllen"]);
    expect(ciudadDe("GAS APODACA CENTRO APO")).toEqual(["APO", "Apodaca"]);
    expect(ciudadDe("STARBUCKS MX CR CIU")).toEqual(["CIU", null]);
    expect(ciudadDe("BATH AND BODY WORKS#55MCA")).toEqual(["MCA", "McAllen"]);
    expect(ciudadDe("TELEVIA PTE CADEREYTA MEX")).toEqual(["MEX", "Cadereyta"]);
    expect(ciudadDe("IZZI DOM CIU", { CIU: "Ciudad X" })).toEqual(["CIU", "Ciudad X"]);
  });

  it("la regla define categoría y comercio; sin regla, Sin categoría y el nombre legible", () => {
    expect(clasificar("TIENDA DEMO CENTRO MCA", REGLAS, {})).toEqual({
      categoria: "Compras",
      comercio: "Demo",
      ciudad_cod: "MCA",
      ciudad: "McAllen",
    });
    expect(clasificar("TIENDA RARA CIU", REGLAS, {})).toEqual({
      categoria: "Sin categoría",
      comercio: "Tienda Rara",
      ciudad_cod: "CIU",
      ciudad: null,
    });
  });

  it("título como el de Python", () => {
    expect(titulo("7ELEVEN MC'DONALDS ñandú")).toBe("7Eleven Mc'Donalds Ñandú");
  });

  it("la fila lleva el monto como texto con dos decimales", () => {
    const aviso = parsearAviso(avisoHtml({ monto: "$ 600.00" }), "m")!;
    expect(aFila(aviso, REGLAS, {})).toMatchObject({ mensaje_id: "m", monto: "600.00", moneda: "MXN", tarjeta: "179" });
    expect(aFila({ ...aviso, centavos: 5 }, REGLAS, {}).monto).toBe("0.05");
  });

  it("reglas y ciudades de preferencias se validan", () => {
    expect(reglasValidas([{ patron: "A", categoria: "B" }, { patron: "", categoria: "X" }, null, 3])).toEqual([
      { patron: "A", categoria: "B", comercio: null },
    ]);
    expect(reglasValidas("nada")).toEqual([]);
    expect(ciudadesValidas({ ciu: "Ciudad X", n: 3 })).toEqual({ CIU: "Ciudad X" });
  });
});

describe("htmlDelMensaje", () => {
  const codificar = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  it("encuentra el HTML en el cuerpo directo o en una parte anidada", () => {
    const html = "<b>operación</b>";
    expect(htmlDelMensaje({ payload: { mimeType: "text/html", body: { data: codificar(html) } } })).toBe(html);
    expect(
      htmlDelMensaje({
        payload: { mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: codificar(html) } }] }] },
      })
    ).toBe(html);
    expect(htmlDelMensaje({ payload: { mimeType: "text/plain", body: {} } })).toBeNull();
  });
});
