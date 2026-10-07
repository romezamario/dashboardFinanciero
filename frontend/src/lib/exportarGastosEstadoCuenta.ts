import type { SheetData } from "write-excel-file/browser";
import {
  CABECERA,
  SUBTOTAL_CATEGORIA,
  SUBTOTAL_COMERCIO,
  TOTAL,
  celdasSumas,
  monto,
  texto,
} from "./exportarGastosDia";
import { sumarUnoEstado, type DiaEstadoCuenta, type MovimientoDia } from "./gastosEstadoCuenta";

// Excel del día en la vista "Por estado de cuenta". Mismas hojas que el de
// correos (Resumen, Detalle, Movimientos) más "No suman" cuando el día tiene
// abonos o categorías ocultas. Los montos son números con formato de pesos.

const izquierda = { ...CABECERA, align: "left" } as const;
const derecha = { ...CABECERA, align: "right" } as const;

function hojaResumen(dia: DiaEstadoCuenta): SheetData {
  const filas: SheetData = [
    [
      texto("Categoría", izquierda),
      ...dia.cuentas.map((c) => texto(c, derecha)),
      texto("Total", derecha),
    ],
  ];
  for (const fila of dia.resumen) {
    filas.push([texto(fila.categoria), ...celdasSumas(fila.sumas, dia.cuentas)]);
  }
  filas.push([texto("Total", TOTAL), ...celdasSumas(dia.total, dia.cuentas, TOTAL)]);
  return filas;
}

/** Igual que la tabla "Detalle por transacción" de la pantalla, subtotales incluidos. */
function hojaDetalle(dia: DiaEstadoCuenta): SheetData {
  const vacias = (estilo: typeof SUBTOTAL_COMERCIO | typeof SUBTOTAL_CATEGORIA | typeof TOTAL, n: number) =>
    Array.from({ length: n }, () => texto("", estilo));
  const filas: SheetData = [
    [
      ...["Categoría", "Comercio", "Descripción", "Tarjeta", "Evento"].map((c) => texto(c, izquierda)),
      ...dia.cuentas.map((c) => texto(c, derecha)),
      texto("Total", derecha),
    ],
  ];
  for (const fila of dia.detalle) {
    if (fila.tipo === "gasto") {
      const g = fila.gasto;
      filas.push([
        texto(g.categoria),
        texto(g.comercio),
        texto(g.descripcion),
        texto(g.tarjeta ?? ""),
        texto(g.evento ?? ""),
        ...celdasSumas(sumarUnoEstado(g, dia.cuentas), dia.cuentas),
      ]);
    } else if (fila.tipo === "comercio") {
      filas.push([
        texto("", SUBTOTAL_COMERCIO),
        texto(`Subtotal ${fila.comercio}`, SUBTOTAL_COMERCIO),
        ...vacias(SUBTOTAL_COMERCIO, 3),
        ...celdasSumas(fila.sumas, dia.cuentas, SUBTOTAL_COMERCIO),
      ]);
    } else {
      filas.push([
        texto(fila.categoria, SUBTOTAL_CATEGORIA),
        texto("Subtotal", SUBTOTAL_CATEGORIA),
        ...vacias(SUBTOTAL_CATEGORIA, 3),
        ...celdasSumas(fila.sumas, dia.cuentas, SUBTOTAL_CATEGORIA),
      ]);
    }
  }
  filas.push([
    texto("Total", TOTAL),
    ...vacias(TOTAL, 4),
    ...celdasSumas(dia.total, dia.cuentas, TOTAL),
  ]);
  return filas;
}

/** Abonos y cargos de categorías ocultas: aparte, con el motivo de por qué no suman. */
function hojaNoSuman(dia: DiaEstadoCuenta): SheetData {
  const filas: SheetData = [
    [
      ...["Categoría", "Descripción", "Cuenta", "Tarjeta", "Evento", "Tipo", "Por qué no suma"].map(
        (c) => texto(c, izquierda)
      ),
      texto("Monto", derecha),
    ],
  ];
  for (const { mov, motivo } of dia.sinSumar) {
    filas.push([
      texto(mov.categoria),
      texto(mov.descripcion),
      texto(mov.cuenta),
      texto(mov.tarjeta ?? ""),
      texto(mov.evento ?? ""),
      texto(mov.tipo === "abono" ? "Abono" : "Cargo"),
      texto(motivo),
      monto(mov.centavos),
    ]);
  }
  return filas;
}

/** Una fila por movimiento (suma o no), la hoja para filtrar o hacer tablas
 * dinámicas. La fecha va como texto ISO para que la zona horaria no la corra. */
function hojaMovimientos(dia: DiaEstadoCuenta): SheetData {
  const columnas = [
    "Fecha", "Cuenta", "Tarjeta", "Categoría", "Comercio", "Descripción", "Evento", "Tipo", "Suma al total",
  ];
  const filas: SheetData = [
    [...columnas.map((c) => texto(c, izquierda)), texto("Monto", derecha)],
  ];
  const todos: { mov: MovimientoDia; suma: boolean }[] = [
    ...dia.gastos.map((mov) => ({ mov, suma: true })),
    ...dia.sinSumar.map(({ mov }) => ({ mov, suma: false })),
  ];
  todos.sort(
    (a, b) =>
      a.mov.cuenta.localeCompare(b.mov.cuenta, "es") ||
      a.mov.descripcion.localeCompare(b.mov.descripcion, "es")
  );
  for (const { mov, suma } of todos) {
    filas.push([
      texto(mov.fecha),
      texto(mov.cuenta),
      texto(mov.tarjeta ?? ""),
      texto(mov.categoria),
      texto(mov.comercio),
      texto(mov.descripcion),
      texto(mov.evento ?? ""),
      texto(mov.tipo === "abono" ? "Abono" : "Cargo"),
      texto(suma ? "Sí" : "No"),
      monto(mov.centavos),
    ]);
  }
  return filas;
}

/** Las hojas del archivo de un día (separado de la descarga para poder
 * armar/inspeccionar el libro sin disparar un "Guardar como"). */
export function hojasDelDiaEstado(dia: DiaEstadoCuenta) {
  const anchoCuentas = dia.cuentas.map(() => ({ width: 18 }));
  const hojas = [];
  if (dia.gastos.length > 0) {
    hojas.push(
      {
        sheet: "Resumen",
        data: hojaResumen(dia),
        columns: [{ width: 24 }, ...anchoCuentas, { width: 14 }],
        stickyRowsCount: 1,
      },
      {
        sheet: "Detalle",
        data: hojaDetalle(dia),
        columns: [
          { width: 20 }, { width: 24 }, { width: 40 }, { width: 12 }, { width: 18 },
          ...anchoCuentas, { width: 14 },
        ],
        stickyRowsCount: 1,
      }
    );
  }
  if (dia.sinSumar.length > 0) {
    hojas.push({
      sheet: "No suman",
      data: hojaNoSuman(dia),
      columns: [
        { width: 20 }, { width: 40 }, { width: 18 }, { width: 12 },
        { width: 18 }, { width: 8 }, { width: 18 }, { width: 14 },
      ],
      stickyRowsCount: 1,
    });
  }
  hojas.push({
    sheet: "Movimientos",
    data: hojaMovimientos(dia),
    columns: [
      { width: 12 }, { width: 18 }, { width: 12 }, { width: 20 }, { width: 24 },
      { width: 40 }, { width: 18 }, { width: 8 }, { width: 13 }, { width: 14 },
    ],
    stickyRowsCount: 1,
  });
  return hojas;
}

export const nombreArchivoDiaEstado = (dia: DiaEstadoCuenta) => `estado-de-cuenta-${dia.fecha}.xlsx`;

/**
 * Descarga el día como `estado-de-cuenta-AAAA-MM-DD.xlsx`. La librería se
 * carga solo al hacer clic: no pesa en el bundle de la pestaña.
 */
export async function descargarDiaEstadoExcel(dia: DiaEstadoCuenta): Promise<void> {
  const { default: escribirExcel } = await import("write-excel-file/browser");
  await escribirExcel(hojasDelDiaEstado(dia)).toFile(nombreArchivoDiaEstado(dia));
}
