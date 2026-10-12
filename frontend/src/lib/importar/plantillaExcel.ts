// La plantilla de Excel que se descarga en "Subir estado de cuenta": una hoja
// "Movimientos" lista para llenar (solo encabezados) y una de "Instrucciones"
// con un ejemplo. excel.ts lee lo que el cliente sube de vuelta.

import type { Sheet } from "write-excel-file/universal";
import { ENCABEZADOS, HOJA_MOVIMIENTOS, NOMBRE_PLANTILLA } from "./excel";

const CABECERA = { fontWeight: "bold", textColor: "#ffffff", backgroundColor: "#1f6f5c" } as const;
const TITULO = { fontWeight: "bold", fontSize: 14 } as const;
const NEGRITA = { fontWeight: "bold" } as const;
const PESOS = '"$"#,##0.00';

const EJEMPLO: readonly (readonly [string, string, number | null, number | null, string, string])[] = [
  ["01/10/2026", "Nómina octubre", null, 18500, "Sueldo", ""],
  ["02/10/2026", "OXXO Insurgentes", 87.5, null, "Supermercado", "OXXO"],
  ["03/10/2026", "Pago de luz CFE", 640, null, "Servicios", "CFE"],
  ["05/10/2026", "Uber", 132.4, null, "", ""],
];

const PASOS = [
  "Llena la hoja Movimientos: una fila por movimiento, empezando en la fila 2. No cambies los encabezados.",
  "Fecha: día/mes/año, por ejemplo 05/10/2026.",
  "Descripción: lo que dice tu estado de cuenta o lo que tú quieras recordar.",
  "Cargo (gasto): lo que salió de tu cuenta o lo que compraste con tu tarjeta. Abono (ingreso): lo que entró. Escribe el monto en solo una de las dos, sin signo.",
  "Categoría y Comercio son opcionales. Si las dejas vacías, Ordena tu Lana propone una categoría con sus reglas y luego la puedes cambiar en tu tablero.",
  "Usa un archivo por cuenta o tarjeta: al subirlo eliges a cuál pertenece.",
  "Si vuelves a subir el archivo con movimientos nuevos, los que ya estaban no se duplican.",
  "Guárdalo como Excel (.xlsx) o CSV y súbelo en Subir estado de cuenta.",
];

export function hojasPlantilla(): Sheet<Blob>[] {
  const anchos = [{ width: 14 }, { width: 40 }, { width: 16 }, { width: 16 }, { width: 22 }, { width: 22 }];
  const encabezados = ENCABEZADOS.map((t) => ({ value: t, ...CABECERA }));
  const pesos = (v: number | null) => (v === null ? null : { value: v, type: Number, format: PESOS });
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
        ...EJEMPLO.map(([fecha, descripcion, cargo, abono, categoria, comercio]) => [
          { value: fecha },
          { value: descripcion },
          pesos(cargo),
          pesos(abono),
          { value: categoria },
          { value: comercio },
        ]),
      ],
      // Los pasos no se ajustan: el texto se ve completo sobre las celdas vacías.
      columns: anchos,
    },
  ];
}

export async function descargarPlantilla(): Promise<void> {
  const { default: escribirExcel } = await import("write-excel-file/universal");
  const blob = await escribirExcel(hojasPlantilla()).toBlob();
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = NOMBRE_PLANTILLA;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
