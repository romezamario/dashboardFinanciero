import { describe, expect, it } from "vitest";
import { anonimizar } from "./anonimizar";
import { leerBanamex, lectorBanamex } from "./banamex";
import { leerBanamexTdc, lectorBanamexTdc } from "./banamexTdc";
import { aCentavos, deCentavos } from "./comun";
import { leerInvexTdc, lectorInvexTdc } from "./invexTdc";
import { agruparEnLineas } from "./lineas";
import { detectarLector, normalizar, procesarPaginas, totales } from "./procesar";

// Mismos casos que tests/test_banamex*.py y test_invex_tdc.py: los lectores
// del navegador son un port de los de la app de escritorio.

const resumen = (r: { fecha: string; descripcion: string; monto: string }) => [r.fecha, r.descripcion, r.monto];

describe("montos en centavos", () => {
  it("convierte sin pasar por float", () => {
    expect(aCentavos("1,234.56")).toBe(123456);
    expect(aCentavos("-0.05")).toBe(-5);
    expect(aCentavos("10.5")).toBe(1050);
    expect(aCentavos("abc")).toBeNull();
    expect(deCentavos(-123456)).toBe("-1234.56");
    expect(deCentavos(5)).toBe("0.05");
  });
});

describe("Banamex cheques", () => {
  it("toma el signo del delta de saldo y advierte bloques sin cerrar", () => {
    const { renglones, advertencias } = leerBanamex(
      [
        ["01 AGO SALDO ANTERIOR 1,000.00", "02 AGO PAGO A", "CONCEPTO A 100.00 900.00", "03 AGO MOVIMIENTO ROTO"],
        ["04 AGO PAGO C 50.00 850.00", "05 AGO NOMINA 1,150.00 2,000.00", "06 AGO SIN CIERRE"],
      ],
      "2026"
    );
    expect(renglones.map(resumen)).toEqual([
      ["02/08/2026", "PAGO A CONCEPTO A", "-100.00"],
      ["04/08/2026", "PAGO C", "-50.00"],
      ["05/08/2026", "NOMINA", "1150.00"],
    ]);
    expect(renglones[0].lineaCruda).toBe("02 AGO PAGO A | CONCEPTO A 100.00 900.00");
    expect(advertencias).toHaveLength(2);
    expect(advertencias[0]).toContain("MOVIMIENTO ROTO");
    expect(advertencias[1]).toContain("SIN CIERRE");
  });

  it("lee el año de la portada y la cuenta sin guardar el número completo", () => {
    const portada = ["Fecha de corte 30 de junio de 2025", "Calle 1 C.P.01234 Cuenta Priority", "Número de cuenta de cheques 12345678901"];
    const { renglones } = leerBanamex([portada, ["01 JUN SALDO ANTERIOR 10.00", "02 JUN X 5.00 15.00"]], "2030");
    expect(renglones[0].fecha).toBe("02/06/2025");
    expect(lectorBanamex.cuenta([portada])).toEqual({ alias: "Cuenta Priority", ultimos4: "8901" });
  });
});

const PORTADA_2024 = [
  "Estado de Cuenta Platino",
  "BANCO NACIONAL DE MEXICO Del 13 de diciembre al 12 de enero de 2025,",
  "PAGO MINIMO $1,000.00",
];

describe("Banamex TDC", () => {
  it("formato actual: signo impreso, secciones de tarjeta y pago interbancario", () => {
    const { renglones, advertencias } = leerBanamexTdc([
      ["Estado de Cuenta Beyond", "Pago mínimo $500.00", "Número de tarjeta: 5256780012344391"],
      [
        "Tarjeta Titular ************4391",
        "01-ene-2025 02-ene-2025 TIENDA DEMO + $10.00",
        "03-ene-2025 03-ene-2025 SU ABONO...GRACIAS - $1,000.00 ..",
        "Tarjeta Adicional ************5555",
        "04-ene-2025 05-ene-2025 PAGO INTERBANCARIO",
        "CONCEPTO: RENTA",
        "REFERENCIA: 123 - $2,000.00",
        "06-ene-2025 06-ene-2025",
      ],
    ]);
    expect(renglones.map((r) => [...resumen(r), r.tarjeta])).toEqual([
      ["01/01/2025", "TIENDA DEMO", "-10.00", "Titular"],
      ["03/01/2025", "PAGO TDC BEYOND", "1000.00", "Titular"],
      ["04/01/2025", "PAGO RECIBIDO RENTA", "2000.00", "Adicional"],
    ]);
    expect(advertencias).toHaveLength(1);
    expect(lectorBanamexTdc.cuenta([["Estado de Cuenta Beyond", "Número de tarjeta: 5256780012344391"]])).toEqual({
      alias: "TDC Beyond",
      ultimos4: "4391",
    });
  });

  it("formato 2024: año del periodo, moneda extranjera en dos líneas y abonos con ' -'", () => {
    const { renglones, advertencias } = leerBanamexTdc([
      PORTADA_2024,
      [
        "Detalle de Operaciones",
        "Fecha Concepto/Lugar de Compra Importe / USD Monto Pesos",
        "Dic 20 TIENDA DEMO SA 0000000X0 1,234.50",
        "Ene 3 SU ABONO...GRACIAS 9,183.49 -",
        "Ene 5 ZOOM.US 888-799-9666 SAN JOSE CA",
        "U.S. DOLLAR 20.00 380.10",
        "Ene 6 PAGO INTERBANCARIO 500.00 -",
        "Pagina 2 de 4",
      ],
    ]);
    expect(renglones.map(resumen)).toEqual([
      ["20/12/2024", "TIENDA DEMO SA 0000000X0", "-1234.50"],
      ["03/01/2025", "PAGO TDC PLATINO", "9183.49"],
      ["05/01/2025", "ZOOM.US 888-799-9666 SAN JOSE CA", "-380.10"],
      ["06/01/2025", "PAGO RECIBIDO", "500.00"],
    ]);
    expect(renglones[2].lineaCruda).toBe("Ene 5 ZOOM.US 888-799-9666 SAN JOSE CA | U.S. DOLLAR 20.00 380.10");
    expect(advertencias).toEqual([]);
  });
});

describe("Invex TDC", () => {
  it("V1: '+' es cargo; V2: 'CR' es abono y sin marca es cargo", () => {
    const { renglones } = leerInvexTdc([
      [
        "Tarjeta Titular ************1096 NOMBRE",
        "01-May-2026 02-May-2026 AMAZON MX CDMX + $1,234.50",
        "05-May-2026 05-May-2026 PAGO RECIBIDO - $500.00 ..",
        "************1096 NOMBRE APELLIDO",
        "10/06/2026 OXXO MONTERREY $85.00",
        "12/06/2026 SU PAGO GRACIAS $2,000.00 CR",
        "************7777 OTRA PERSONA",
        "13/06/2026 CINE $150.00",
      ],
    ]);
    expect(renglones.map((r) => [r.fecha, r.monto, r.tarjeta])).toEqual([
      ["01/05/2026", "-1234.50", "Titular"],
      ["05/05/2026", "500.00", "Titular"],
      ["10/06/2026", "-85.00", "1096"],
      ["12/06/2026", "2000.00", "1096"],
      ["13/06/2026", "-150.00", "7777"],
    ]);
  });
});

describe("detección", () => {
  const cheques = [["BANAMEX", "FECHA CONCEPTO RETIROS DEPOSITOS SALDO"]];
  const tdc = [["Estado de Cuenta Platino", "Pago mínimo $1.00"]];
  const invex = [["INVEX Banco", "Pago mínimo $1.00"]];

  it("cada documento lo reconoce exactamente un lector", () => {
    expect(detectarLector(cheques)).toBe(lectorBanamex);
    expect(detectarLector(tdc)).toBe(lectorBanamexTdc);
    expect(detectarLector(invex)).toBe(lectorInvexTdc);
    expect(detectarLector([["BBVA", "Saldo"]])).toBeNull();
  });

  it("si dos lectores lo reclaman, no adivina", () => {
    expect(detectarLector(cheques, [lectorBanamex, { ...lectorBanamex, banco: "Otro" }])).toBeNull();
  });
});

describe("normalizar y procesar", () => {
  it("fecha ISO, monto sin signo + tipo, y sufijos para líneas repetidas", () => {
    const base = { descripcion: "TELEVIA", pagina: 1, lineaCruda: "TELEVIA 50.00", tarjeta: null };
    const { movimientos, errores } = normalizar([
      { ...base, fecha: "02/08/2026", monto: "-50.00" },
      { ...base, fecha: "02/08/2026", monto: "-50.00" },
      { ...base, fecha: "31/02/2026", monto: "10.00" },
    ]);
    expect(movimientos.map((m) => [m.fecha, m.monto, m.tipo, m.linea_cruda])).toEqual([
      ["2026-08-02", "50.00", "cargo", "TELEVIA 50.00"],
      ["2026-08-02", "50.00", "cargo", "TELEVIA 50.00 (2)"],
    ]);
    expect(errores).toHaveLength(1);
    expect(totales(movimientos)).toEqual({ cargos: 10000, abonos: 0 });
  });

  it("un PDF sin texto o de un banco desconocido se vuelve muestra anonimizada", () => {
    expect(procesarPaginas([[], []])).toMatchObject({ reconocido: false, motivo: "sin-texto", paginas: 2 });
    const desconocido = procesarPaginas([["BBVA MEXICO", "Juan Pérez 15/08/2026 OXXO 1,234.50"]]);
    expect(desconocido).toMatchObject({ reconocido: false, motivo: "banco-desconocido" });
    expect(desconocido.muestra).toBe("--- Página 1 ---\nBBVA MEXICO\nXxxx Xxxxx 00/00/0000 XXXX 0,000.00");
  });

  it("reconocido pero sin movimientos también pide muestra", () => {
    expect(procesarPaginas([["BANAMEX", "FECHA CONCEPTO RETIROS"]])).toMatchObject({
      reconocido: false,
      motivo: "sin-movimientos",
      banco: "Banamex",
    });
  });
});

describe("anonimizar", () => {
  it("borra letras y dígitos salvo el vocabulario bancario", () => {
    expect(anonimizar("SALDO ANTERIOR de Ana López 1,234.56")).toBe("SALDO ANTERIOR de Xxx Xxxxx 0,000.00");
  });
});

describe("líneas de pdf.js", () => {
  it("agrupa por renglón, ordena por x y separa los huecos", () => {
    const f = (texto: string, x: number, y: number, ancho: number) => ({ texto, x, y, ancho, alto: 8 });
    expect(
      agruparEnLineas([
        f("100.00", 300, 700.5, 30),
        f("02 AGO", 20, 700, 30),
        f("PAGO", 60, 701, 20),
        f("SALDO", 20, 720, 25),
        f("ANTERIOR", 48, 720, 38),
        f("1,000", 90, 720, 20),
        f(".00", 110, 720, 10),
        f("  ", 20, 650, 5),
      ])
    ).toEqual(["SALDO ANTERIOR 1,000.00", "02 AGO PAGO 100.00"]);
  });
});
