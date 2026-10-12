import readExcel from "read-excel-file/universal";
import writeExcel from "write-excel-file/universal";
import { describe, expect, it } from "vitest";
import { type Celda, filasDeCsv, HOJA_MOVIMIENTOS, interpretarFilas, leerFecha, leerMonto } from "./excel";
import { cambiosDeCategoria } from "./guardarExcel";
import { hojasPlantilla } from "./plantillaExcel";

const ENC = ["Fecha", "Descripción", "Cargo (gasto)", "Abono (ingreso)", "Categoría (opcional)", "Comercio (opcional)"];

describe("leerFecha", () => {
  it("acepta celdas de fecha, número de serie y texto con el día primero", () => {
    expect(leerFecha(new Date(Date.UTC(2026, 9, 5)))).toBe("2026-10-05");
    expect(leerFecha(46000)).toBe("2025-12-09");
    expect(leerFecha("05/10/2026")).toBe("2026-10-05");
    expect(leerFecha("5-10-26")).toBe("2026-10-05");
    expect(leerFecha("2026-10-05")).toBe("2026-10-05");
  });
  it("rechaza fechas imposibles o texto", () => {
    expect(leerFecha("31/02/2026")).toBeNull();
    expect(leerFecha("ayer")).toBeNull();
    expect(leerFecha(null)).toBeNull();
  });
});

describe("leerMonto", () => {
  it("devuelve centavos exactos", () => {
    expect(leerMonto(87.5)).toBe(8750);
    expect(leerMonto(0.1 + 0.2)).toBe(30);
    expect(leerMonto("$1,234.56")).toBe(123456);
    expect(leerMonto("-45")).toBe(-4500);
    expect(leerMonto("(45.00)")).toBe(-4500);
  });
  it("vacío = null, texto = NaN", () => {
    expect(leerMonto(null)).toBeNull();
    expect(leerMonto("  ")).toBeNull();
    expect(leerMonto("mucho")).toBeNaN();
  });
});

describe("interpretarFilas", () => {
  it("lee cargos y abonos de la plantilla, con categoría opcional", () => {
    const { movimientos, errores } = interpretarFilas([
      ENC,
      [new Date(Date.UTC(2026, 9, 1)), "Nómina", null, 18500, "Sueldo", null],
      ["02/10/2026", "OXXO", 87.5, null, null, "OXXO"],
    ]);
    expect(errores).toEqual([]);
    expect(movimientos).toMatchObject([
      { fila: 2, fecha: "2026-10-01", descripcion: "Nómina", monto: "18500.00", tipo: "abono", categoria: "Sueldo", comercio: null },
      { fila: 3, fecha: "2026-10-02", descripcion: "OXXO", monto: "87.50", tipo: "cargo", categoria: null, comercio: "OXXO" },
    ]);
    expect(movimientos[1].linea_cruda).toBe("(excel) 2026-10-02 | OXXO | 87.50 | cargo");
  });

  it("dos filas idénticas reciben (2) y la llave no depende del número de fila", () => {
    const fila = ["03/10/2026", "Caseta", 45, null];
    const a = interpretarFilas([ENC, fila, fila]).movimientos.map((m) => m.linea_cruda);
    const b = interpretarFilas([ENC, ["01/10/2026", "Otra", 1, null], [], fila, fila]).movimientos.map((m) => m.linea_cruda);
    expect(a).toEqual(["(excel) 2026-10-03 | Caseta | 45.00 | cargo", "(excel) 2026-10-03 | Caseta | 45.00 | cargo (2)"]);
    expect(b.slice(1)).toEqual(a);
  });

  it("reporta filas malas con su número y guarda las buenas", () => {
    const { movimientos, errores } = interpretarFilas([
      ENC,
      ["32/10/2026", "Mala fecha", 1, null],
      ["01/10/2026", "", 1, null],
      ["01/10/2026", "Sin monto", null, null],
      ["01/10/2026", "Ambos", 1, 2],
      ["01/10/2026", "Letras", "mucho", null],
      ["01/10/2026", "Bien", 10, null],
    ]);
    expect(movimientos.map((m) => m.descripcion)).toEqual(["Bien"]);
    expect(errores.map((e) => e.split(":")[0])).toEqual(["Fila 2", "Fila 3", "Fila 4", "Fila 5", "Fila 6"]);
  });

  it("encuentra los encabezados aunque haya títulos arriba y acepta Monto con signo o con Tipo", () => {
    const conSigno = interpretarFilas([["Mi banco"], [], ["fecha", "concepto", "importe"], ["01/10/2026", "Renta", -9000]]);
    expect(conSigno.movimientos[0]).toMatchObject({ tipo: "cargo", monto: "9000.00" });
    // El CSV de "Exportar mis datos".
    const exportado = interpretarFilas([
      ["fecha", "descripcion", "monto", "tipo", "categoria", "comercio"],
      ["2026-10-01", "Uber", "132.4", "cargo", "Transporte", "Uber"],
    ]);
    expect(exportado.movimientos[0]).toMatchObject({ tipo: "cargo", monto: "132.40", categoria: "Transporte" });
  });

  it("sin encabezados lo dice", () => {
    expect(interpretarFilas([["a", "b"], [1, 2]]).errores[0]).toMatch(/encabezados/);
  });
});

describe("filasDeCsv", () => {
  it("entiende comillas, punto y coma, BOM y el apóstrofo anti-fórmulas", () => {
    expect(filasDeCsv('﻿fecha;descripcion;monto\r\n01/10/2026;"Pago; ""luz""";-640\r\n')).toEqual([
      ["fecha", "descripcion", "monto"],
      ["01/10/2026", 'Pago; "luz"', "-640"],
    ]);
    expect(filasDeCsv("a,b\n'-SPEI,1")[1][0]).toBe("-SPEI");
  });
});

describe("plantilla", () => {
  it("se lee de vuelta: la hoja Movimientos trae los encabezados que reconoce el lector", async () => {
    const blob = await writeExcel(hojasPlantilla()).toBlob();
    const hojas = await readExcel(await blob.arrayBuffer());
    expect(hojas.map((h) => h.sheet)).toEqual([HOJA_MOVIMIENTOS, "Instrucciones"]);
    const movimientos = hojas[0].data as unknown as Celda[][];
    expect(interpretarFilas([...movimientos, ["05/10/2026", "Uber", 132.4, null]]).movimientos).toHaveLength(1);
  });

  it("un Excel llenado con fechas y montos de verdad se lee igual", async () => {
    const blob = await writeExcel([
      ENC.map((value) => ({ value })),
      [
        { value: new Date(Date.UTC(2026, 9, 5)), type: Date, format: "dd/mm/yyyy" },
        { value: "Farmacia" },
        { value: 250.75, type: Number },
        null,
      ],
    ]).toBlob();
    const [{ data }] = await readExcel(await blob.arrayBuffer());
    expect(interpretarFilas(data as unknown as Celda[][]).movimientos[0]).toMatchObject({ fecha: "2026-10-05", monto: "250.75", tipo: "cargo" });
  });
});

describe("cambiosDeCategoria", () => {
  const fila = (id: string, linea: string, descripcion: string, categoria_id: string | null = null, comercio: string | null = null) => ({
    id,
    linea_cruda: linea,
    descripcion,
    categoria_id,
    comercio,
  });
  it("lo escrito en el Excel gana; si no hay nada, reglas base solo en filas sin categoría ni comercio", () => {
    const grupos = cambiosDeCategoria(
      [
        fila("1", "a", "Nómina", "cat-vieja"),
        fila("2", "b", "OXXO INSURGENTES"),
        fila("3", "c", "OXXO INSURGENTES", "cat-editada"),
        fila("4", "d", "Algo raro"),
      ],
      new Map([
        ["a", { categoria: "Sueldo", comercio: null }],
        ["b", { categoria: null, comercio: null }],
        ["c", { categoria: null, comercio: null }],
        ["d", { categoria: null, comercio: null }],
      ])
    );
    const porId = new Map([...grupos.values()].flatMap((g) => g.ids.map((id) => [id, g] as const)));
    expect(porId.get("1")).toMatchObject({ categoria: "Sueldo" });
    expect(porId.get("2")?.categoria).toBeTruthy();
    expect(porId.has("3")).toBe(false);
    expect(porId.has("4")).toBe(false);
  });
});
