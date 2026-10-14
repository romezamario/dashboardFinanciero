// Un movimiento capturado a mano en "Subir movimientos" (CapturaManual.tsx):
// validación del formulario y la `linea_cruda` que lo identifica. Sin red,
// para probarlo con Vitest; lo guarda `guardarManual` (guardarExcel.ts).

import { deCentavos } from "./comun";
import { leerFecha, leerMonto } from "./excel";
import type { MovimientoImportado } from "./procesar";

/** Prefijo de `linea_cruda`: distingue lo capturado a mano de una fila de
 * Excel o un renglón de PDF (mismo prefijo que la app de escritorio). */
export const PREFIJO_MANUAL = "(manual) ";

export const LARGO_MAXIMO_DESCRIPCION = 200;
export const LARGO_MAXIMO_NOMBRE = 100;
/** Tope de un movimiento: más que esto casi seguro es un error al teclear. */
export const MONTO_MAXIMO_CENTAVOS = 100_000_000_00;

export interface CamposManual {
  fecha: string;
  descripcion: string;
  monto: string;
  tipo: "cargo" | "abono";
  categoria: string;
  comercio: string;
}

export interface MovimientoManual extends MovimientoImportado {
  categoria: string | null;
  comercio: string | null;
}

const limpio = (t: string) => t.replace(/\s+/g, " ").trim();

/** Valida el formulario. `hoy` (AAAA-MM-DD, del navegador) es el límite: un
 * gasto con fecha futura descuadraría los promedios del día. La `linea_cruda`
 * aún no lleva el sufijo " (2)" de un movimiento idéntico: eso se decide al
 * guardar, contra lo que ya está guardado (`lineaLibre`). */
export function validarManual(
  campos: CamposManual,
  hoy: string
): { movimiento: MovimientoManual; error?: never } | { error: string; movimiento?: never } {
  const fecha = leerFecha(campos.fecha.trim());
  if (!fecha) return { error: "Escribe una fecha válida." };
  if (fecha > hoy) return { error: "La fecha no puede ser después de hoy." };
  const descripcion = limpio(campos.descripcion);
  if (!descripcion) return { error: "Escribe una descripción, por ejemplo dónde fue el gasto." };
  if (descripcion.length > LARGO_MAXIMO_DESCRIPCION)
    return { error: `La descripción es muy larga (máximo ${LARGO_MAXIMO_DESCRIPCION} caracteres).` };
  const centavos = leerMonto(campos.monto);
  if (centavos === null) return { error: "Escribe el monto." };
  if (Number.isNaN(centavos)) return { error: "El monto no se entiende; escríbelo como 1250.50." };
  if (centavos === 0) return { error: "El monto debe ser mayor que cero." };
  const absoluto = Math.abs(centavos);
  if (absoluto > MONTO_MAXIMO_CENTAVOS) return { error: "El monto es demasiado grande; revisa que esté bien escrito." };
  const monto = deCentavos(absoluto);
  return {
    movimiento: {
      fecha,
      descripcion,
      monto,
      tipo: campos.tipo,
      pagina: 0,
      linea_cruda: `${PREFIJO_MANUAL}${fecha} | ${descripcion} | ${monto} | ${campos.tipo}`,
      tarjeta: null,
      categoria: limpio(campos.categoria).slice(0, LARGO_MAXIMO_NOMBRE) || null,
      comercio: limpio(campos.comercio).slice(0, LARGO_MAXIMO_NOMBRE) || null,
    },
  };
}

/** La primera `linea_cruda` libre: dos cafés iguales el mismo día son dos
 * movimientos, así que el segundo se guarda como "… (2)" (la llave del upsert
 * es documento + página + línea). */
export function lineaLibre(base: string, existentes: Iterable<string>): string {
  const usadas = new Set(existentes);
  if (!usadas.has(base)) return base;
  let n = 2;
  while (usadas.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
