import type { SheetData } from "write-excel-file/browser";
import { nombreTarjeta, sumarUno, type DiaGastos, type Sumas } from "./gastosCorreo";

// Formato de moneda de Excel (se ve "$1,234.50"); el valor de la celda sigue
// siendo un número, así que se puede sumar/filtrar en Excel.
const PESOS = '"$"#,##0.00';

const CABECERA = { fontWeight: "bold", textColor: "#ffffff", backgroundColor: "#222222" } as const;
const SUBTOTAL_COMERCIO = { fontStyle: "italic", backgroundColor: "#f3f3f3" } as const;
const SUBTOTAL_CATEGORIA = { fontWeight: "bold", backgroundColor: "#dcdcdc" } as const;
const TOTAL = { fontWeight: "bold", textColor: "#ffffff", backgroundColor: "#222222" } as const;

interface Estilo {
  fontWeight?: "bold";
  fontStyle?: "italic";
  textColor?: string;
  backgroundColor?: string;
  align?: "left" | "center" | "right";
}

const texto = (valor: string, estilo: Estilo = {}) => ({ value: valor, ...estilo });

/** Monto en pesos (el dato va en centavos enteros). En las filas sin estilo un
 * cero se deja vacío, como en pantalla; en las con relleno se escribe una celda
 * vacía con el mismo fondo para que la fila no quede "rota". */
function monto(centavos: number | undefined, estilo: Estilo = {}) {
  if (!centavos) return Object.keys(estilo).length > 0 ? texto("", estilo) : null;
  return {
    value: centavos / 100,
    type: Number,
    format: PESOS,
    ...estilo,
    align: "right" as const,
  };
}

function celdasSumas(sumas: Sumas, tarjetas: string[], estilo: Estilo = {}) {
  return [...tarjetas.map((t) => monto(sumas.porTarjeta[t], estilo)), monto(sumas.total, estilo)];
}

function hojaResumen(dia: DiaGastos): SheetData {
  const filas: SheetData = [
    [
      texto("Categoría", { ...CABECERA, align: "left" }),
      ...dia.tarjetas.map((t) => texto(nombreTarjeta(t), { ...CABECERA, align: "right" })),
      texto("Total", { ...CABECERA, align: "right" }),
    ],
  ];
  for (const fila of dia.resumen) {
    filas.push([texto(fila.categoria), ...celdasSumas(fila.sumas, dia.tarjetas)]);
  }
  filas.push([texto("Total", TOTAL), ...celdasSumas(dia.total, dia.tarjetas, TOTAL)]);
  return filas;
}

/** Igual que la tabla "Detalle por transacción" de la pantalla, subtotales incluidos. */
function hojaDetalle(dia: DiaGastos): SheetData {
  const encabezado = ["Categoría", "Comercio", "Ciudad", "Hora"];
  const filas: SheetData = [
    [
      ...encabezado.map((c) => texto(c, { ...CABECERA, align: "left" })),
      ...dia.tarjetas.map((t) => texto(nombreTarjeta(t), { ...CABECERA, align: "right" })),
      texto("Total", { ...CABECERA, align: "right" }),
    ],
  ];
  for (const fila of dia.detalle) {
    if (fila.tipo === "gasto") {
      const g = fila.gasto;
      filas.push([
        texto(g.categoria),
        texto(g.comercio),
        texto(g.ciudad ?? g.ciudad_cod ?? ""),
        texto(g.hora),
        ...celdasSumas(sumarUno(g, dia.tarjetas), dia.tarjetas),
      ]);
    } else if (fila.tipo === "comercio") {
      filas.push([
        texto("", SUBTOTAL_COMERCIO),
        texto(`Subtotal ${fila.comercio}`, SUBTOTAL_COMERCIO),
        texto("", SUBTOTAL_COMERCIO),
        texto("", SUBTOTAL_COMERCIO),
        ...celdasSumas(fila.sumas, dia.tarjetas, SUBTOTAL_COMERCIO),
      ]);
    } else {
      filas.push([
        texto(fila.categoria, SUBTOTAL_CATEGORIA),
        texto("Subtotal", SUBTOTAL_CATEGORIA),
        texto("", SUBTOTAL_CATEGORIA),
        texto("", SUBTOTAL_CATEGORIA),
        ...celdasSumas(fila.sumas, dia.tarjetas, SUBTOTAL_CATEGORIA),
      ]);
    }
  }
  filas.push([
    texto("Total", TOTAL),
    texto("", TOTAL),
    texto("", TOTAL),
    texto("", TOTAL),
    ...celdasSumas(dia.total, dia.tarjetas, TOTAL),
  ]);
  return filas;
}

/** Una fila por cargo, sin subtotales: la hoja para filtrar, ordenar o hacer
 * tablas dinámicas. La fecha va como texto ISO para que la zona horaria no
 * la corra un día. */
function hojaMovimientos(dia: DiaGastos): SheetData {
  const columnas = ["Fecha", "Hora", "Tarjeta", "Categoría", "Comercio", "Establecimiento", "Ciudad"];
  const filas: SheetData = [
    [
      ...columnas.map((c) => texto(c, { ...CABECERA, align: "left" })),
      texto("Monto", { ...CABECERA, align: "right" }),
    ],
  ];
  const ordenados = [...dia.gastos].sort((a, b) => a.hora.localeCompare(b.hora));
  for (const g of ordenados) {
    filas.push([
      texto(g.fecha),
      texto(g.hora),
      texto(nombreTarjeta(g.tarjeta)),
      texto(g.categoria),
      texto(g.comercio),
      texto(g.establecimiento ?? ""),
      texto(g.ciudad ?? g.ciudad_cod ?? ""),
      monto(Math.round(g.monto * 100)),
    ]);
  }
  return filas;
}

/** Las tres hojas del archivo de un día (separado de la descarga para poder
 * armar/inspeccionar el libro sin disparar un "Guardar como"). */
export function hojasDelDia(dia: DiaGastos) {
  const anchoTarjetas = dia.tarjetas.map(() => ({ width: 24 }));
  return [
    {
      sheet: "Resumen",
      data: hojaResumen(dia),
      columns: [{ width: 24 }, ...anchoTarjetas, { width: 14 }],
      stickyRowsCount: 1,
    },
    {
      sheet: "Detalle",
      data: hojaDetalle(dia),
      columns: [{ width: 20 }, { width: 28 }, { width: 14 }, { width: 8 }, ...anchoTarjetas, { width: 14 }],
      stickyRowsCount: 1,
    },
    {
      sheet: "Movimientos",
      data: hojaMovimientos(dia),
      columns: [
        { width: 12 }, { width: 8 }, { width: 24 }, { width: 18 },
        { width: 28 }, { width: 28 }, { width: 14 }, { width: 14 },
      ],
      stickyRowsCount: 1,
    },
  ];
}

export const nombreArchivoDia = (dia: DiaGastos) => `gastos-${dia.fecha}.xlsx`;

/**
 * Descarga el día como `gastos-AAAA-MM-DD.xlsx` con tres hojas: Resumen y
 * Detalle (lo mismo que se ve en pantalla) y Movimientos (una fila por cargo).
 * La librería se carga solo al hacer clic: no pesa en el bundle de la pestaña.
 */
export async function descargarDiaExcel(dia: DiaGastos): Promise<void> {
  const { default: escribirExcel } = await import("write-excel-file/browser");
  await escribirExcel(hojasDelDia(dia)).toFile(nombreArchivoDia(dia));
}
