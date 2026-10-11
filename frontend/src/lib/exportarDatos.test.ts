import { describe, expect, it } from "vitest";
import { campoCsv, nombreArchivoExportacion, transaccionesACsv } from "./exportarDatos";
import { transaccion } from "../test/fabrica";

describe("campoCsv", () => {
  it("entrecomilla comas, comillas y saltos de línea", () => {
    expect(campoCsv("OXXO, SUC 12")).toBe('"OXXO, SUC 12"');
    expect(campoCsv('DICE "HOLA"')).toBe('"DICE ""HOLA"""');
    expect(campoCsv("A\nB")).toBe('"A\nB"');
    expect(campoCsv("SIMPLE")).toBe("SIMPLE");
  });

  it("neutraliza lo que Excel tomaría como fórmula", () => {
    expect(campoCsv("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(campoCsv("-ABONO")).toBe("'-ABONO");
    expect(campoCsv("+1")).toBe("'+1");
  });

  it("números tal cual y null vacío", () => {
    expect(campoCsv(-12.5)).toBe("-12.5");
    expect(campoCsv(null)).toBe("");
  });
});

describe("transaccionesACsv", () => {
  it("una fila por movimiento, ordenadas por fecha, con BOM y CRLF", () => {
    const csv = transaccionesACsv([
      transaccion({ fecha: "2026-09-02", descripcion: "UBER", monto: 85.5, categoria: "Transporte", comercio: "Uber" }),
      transaccion({ fecha: "2026-08-30", descripcion: "NOMINA", monto: 20000, tipo: "abono", cuenta: "Priority", banco: "Banamex", evento: "Viaje" }),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lineas = csv.slice(1).split("\r\n");
    expect(lineas[0]).toBe("fecha,descripcion,monto,tipo,categoria,comercio,evento,cuenta,banco,tarjeta");
    expect(lineas[1]).toBe("2026-08-30,NOMINA,20000,abono,,,Viaje,Priority,Banamex,");
    expect(lineas[2]).toBe("2026-09-02,UBER,85.5,cargo,Transporte,Uber,,TDC Beyond,Banamex TDC,");
    expect(lineas[3]).toBe("");
  });

  it("sin movimientos solo trae el encabezado", () => {
    expect(transaccionesACsv([]).slice(1).split("\r\n")).toHaveLength(2);
  });

  it("nombra el archivo con la fecha", () => {
    expect(nombreArchivoExportacion("2026-10-11")).toBe("finanzaspersonales-movimientos-2026-10-11.csv");
  });
});
