// La plantilla de Excel que se descarga en "Subir estado de cuenta": una hoja
// "Movimientos" lista para llenar (solo encabezados) y una de "Instrucciones"
// con un ejemplo. excel.ts lee lo que el cliente sube de vuelta.

import type { Feature, Sheet } from "write-excel-file/universal";
import { ENCABEZADOS, HOJA_MOVIMIENTOS, NOMBRE_PLANTILLA, TIPO_GASTO, TIPO_INGRESO } from "./excel";

const CABECERA = { fontWeight: "bold", textColor: "#ffffff", backgroundColor: "#1f6f5c" } as const;
const TITULO = { fontWeight: "bold", fontSize: 14 } as const;
const NEGRITA = { fontWeight: "bold" } as const;
const PESOS = '"$"#,##0.00';

const EJEMPLO: readonly (readonly [string, string, number, string, string, string])[] = [
  ["01/10/2026", "Nómina octubre", 18500, TIPO_INGRESO, "Sueldo", ""],
  ["02/10/2026", "OXXO Insurgentes", 87.5, TIPO_GASTO, "Supermercado", "OXXO"],
  ["03/10/2026", "Pago de luz CFE", 640, TIPO_GASTO, "Servicios", "CFE"],
  ["05/10/2026", "Uber", 132.4, TIPO_GASTO, "", ""],
];

/** Filas de la hoja Movimientos con lista desplegable en Tipo y monto > 0. */
const FILAS_CON_VALIDACION = 5000;

const PASOS = [
  "Llena la hoja Movimientos: una fila por movimiento, empezando en la fila 2. No cambies los encabezados.",
  "Fecha: día/mes/año, por ejemplo 05/10/2026.",
  "Descripción: lo que dice tu estado de cuenta o lo que tú quieras recordar.",
  "Monto: la cantidad sin signo, por ejemplo 87.50.",
  "Tipo: elígelo de la lista. Gasto = lo que salió de tu cuenta o compraste con tu tarjeta. Ingreso = lo que entró.",
  "Categoría y Comercio son opcionales. Si las dejas vacías, Ordena tu Lana propone una categoría con sus reglas y luego la puedes cambiar en tu tablero.",
  "Usa un archivo por cuenta o tarjeta: al subirlo eliges a cuál pertenece.",
  "Si vuelves a subir el archivo con movimientos nuevos, los que ya estaban no se duplican.",
  "Guárdalo como Excel (.xlsx) o CSV y súbelo en Subir estado de cuenta.",
];

export function hojasPlantilla(): Sheet<Blob>[] {
  const anchos = [{ width: 14 }, { width: 40 }, { width: 16 }, { width: 16 }, { width: 22 }, { width: 22 }];
  const encabezados = ENCABEZADOS.map((t) => ({ value: t, ...CABECERA }));
  const pesos = (v: number) => ({ value: v, type: Number, format: PESOS });
  return [
    {
      sheet: HOJA_MOVIMIENTOS,
      data: [encabezados],
      columns: anchos,
      stickyRowsCount: 1,
    },
    {
      sheet: "Instrucciones",
      data: [
        [{ value: "Cómo llenar la plantilla de Ordena tu Lana", ...TITULO }],
        [null],
        ...PASOS.map((paso, i) => [{ value: `${i + 1}. ${paso}` }]),
        [null],
        [{ value: "Ejemplo", ...NEGRITA }],
        encabezados,
        ...EJEMPLO.map(([fecha, descripcion, monto, tipo, categoria, comercio]) => [
          { value: fecha },
          { value: descripcion },
          pesos(monto),
          { value: tipo },
          { value: categoria },
          { value: comercio },
        ]),
      ],
      // Los pasos no se ajustan: el texto se ve completo sobre las celdas vacías.
      columns: anchos,
    },
  ];
}

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Validaciones de datos de Excel en la hoja Movimientos: Tipo como lista
 * desplegable (Gasto/Ingreso) y Monto mayor que cero. write-excel-file no las
 * trae, así que se agregan al XML de la hoja (van justo después de
 * <sheetData>, como pide el orden del formato). */
export const validacionesMovimientos: Feature<Blob> = {
  files: {
    transform: {
      "xl/worksheets/sheet{id}.xml": {
        transform(contenido, opciones) {
          if (opciones.sheet !== HOJA_MOVIMIENTOS || contenido.includes("<dataValidations")) return contenido;
          const hasta = FILAS_CON_VALIDACION + 1;
          const tipo =
            `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" ` +
            `promptTitle="Tipo" prompt="${escapar(`${TIPO_GASTO}: lo que salió. ${TIPO_INGRESO}: lo que entró.`)}" ` +
            `errorTitle="Tipo" error="${escapar(`Elige ${TIPO_GASTO} o ${TIPO_INGRESO} de la lista.`)}" sqref="D2:D${hasta}">` +
            `<formula1>"${TIPO_GASTO},${TIPO_INGRESO}"</formula1></dataValidation>`;
          const monto =
            `<dataValidation type="decimal" operator="greaterThan" allowBlank="1" showErrorMessage="1" ` +
            `errorTitle="Monto" error="${escapar("Escribe la cantidad sin signo, mayor que cero (el tipo dice si es gasto o ingreso).")}" sqref="C2:C${hasta}">` +
            `<formula1>0</formula1></dataValidation>`;
          return contenido.replace("</sheetData>", `</sheetData><dataValidations count="2">${tipo}${monto}</dataValidations>`);
        },
      },
    },
  },
};

export async function descargarPlantilla(): Promise<void> {
  const { default: escribirExcel } = await import("write-excel-file/universal");
  const blob = await escribirExcel(hojasPlantilla(), { features: [validacionesMovimientos] }).toBlob();
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = NOMBRE_PLANTILLA;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
