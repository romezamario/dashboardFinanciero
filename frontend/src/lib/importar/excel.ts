// Subir movimientos desde una plantilla de Excel (o un CSV) en Ordena tu Lana,
// para los bancos que todavía no leemos en PDF o para quien prefiera capturar
// a mano. Igual que con los PDFs, el archivo se lee aquí, en el navegador; solo
// se guardan los movimientos. Sin red ni React: probado en excel.test.ts.
//
// Las columnas se reconocen por su encabezado (sin importar acentos ni
// mayúsculas), así que también entra el CSV de "Exportar mis datos" (fecha,
// descripcion, monto, tipo, categoria, comercio) y muchos archivos que los
// bancos dejan descargar con columnas Cargo/Abono.

import { aCentavos, deCentavos } from "./comun";
import type { MovimientoImportado } from "./procesar";

/** Una celda como la entrega read-excel-file (su tipo `CellValue` dice
 * `typeof Date`, el constructor, pero lo que llega es una fecha). */
export type Celda = string | number | boolean | Date | null | undefined;
type Filas = readonly (readonly Celda[])[];

export const NOMBRE_PLANTILLA = "plantilla-ordena-tu-lana.xlsx";
export const HOJA_MOVIMIENTOS = "Movimientos";
export const MAXIMO_FILAS = 20_000;
/** Prefijo de `linea_cruda`: distingue lo capturado en Excel de un renglón de PDF. */
export const PREFIJO_EXCEL = "(excel) ";

/** Encabezados de la plantilla, en orden. Una sola columna de monto (sin
 * signo) y el tipo aparte, con lista Gasto/Ingreso: con dos columnas
 * Cargo/Abono era fácil llenarlo todo en una. Las columnas Cargo/Abono de la
 * primera versión se siguen leyendo. */
export const TIPO_GASTO = "Gasto";
export const TIPO_INGRESO = "Ingreso";

export const ENCABEZADOS = [
  "Fecha",
  "Descripción",
  "Monto",
  "Tipo (Gasto o Ingreso)",
  "Categoría (opcional)",
  "Comercio (opcional)",
] as const;

export interface MovimientoExcel extends MovimientoImportado {
  /** Fila de la hoja (como la numera Excel), para los mensajes. */
  fila: number;
  categoria: string | null;
  comercio: string | null;
}

export interface LecturaExcel {
  movimientos: MovimientoExcel[];
  /** Filas que no se pudieron leer, con el motivo (no se guardan). */
  errores: string[];
}

type Campo = "fecha" | "descripcion" | "cargo" | "abono" | "monto" | "tipo" | "categoria" | "comercio";

/** Primera palabra del encabezado (sin acentos, minúsculas) → campo. */
const SINONIMOS: Record<string, Campo> = {
  fecha: "fecha",
  descripcion: "descripcion",
  concepto: "descripcion",
  cargo: "cargo",
  cargos: "cargo",
  gasto: "cargo",
  gastos: "cargo",
  retiro: "cargo",
  retiros: "cargo",
  abono: "abono",
  abonos: "abono",
  ingreso: "abono",
  ingresos: "abono",
  deposito: "abono",
  depositos: "abono",
  monto: "monto",
  importe: "monto",
  tipo: "tipo",
  categoria: "categoria",
  comercio: "comercio",
};

export function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function campoDe(encabezado: Celda): Campo | null {
  if (typeof encabezado !== "string") return null;
  const palabra = /^[a-z]+/.exec(sinAcentos(encabezado))?.[0];
  return palabra ? (SINONIMOS[palabra] ?? null) : null;
}

/** La fila de encabezados: la primera (de las 20 de arriba) con Fecha,
 * Descripción y algún monto. */
function buscarEncabezados(filas: Filas): { fila: number; columnas: Map<Campo, number> } | null {
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const columnas = new Map<Campo, number>();
    filas[i].forEach((celda, j) => {
      const campo = campoDe(celda);
      if (campo && !columnas.has(campo)) columnas.set(campo, j);
    });
    const tieneMonto = columnas.has("cargo") || columnas.has("abono") || columnas.has("monto");
    if (columnas.has("fecha") && columnas.has("descripcion") && tieneMonto) return { fila: i, columnas };
  }
  return null;
}

function iso(anio: number, mes: number, dia: number): string | null {
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null;
  if (anio < 1990 || anio > 2100) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Una fecha de Excel → AAAA-MM-DD. Acepta celdas de fecha, el número de serie
 * de Excel y texto DD/MM/AAAA, DD-MM-AAAA o AAAA-MM-DD (en México el día va
 * primero). */
export function leerFecha(valor: Celda): string | null {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    // read-excel-file entrega la fecha del calendario a medianoche UTC.
    return iso(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate());
  }
  if (typeof valor === "number") {
    if (valor < 20_000 || valor > 80_000) return null;
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(valor) * 86_400_000);
    return iso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  }
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(anio, Number(m[2]), Number(m[1]));
  }
  return null;
}

/** Un monto → centavos con signo (null si la celda está vacía, NaN si no se
 * entiende). Acepta números y texto como "$1,234.56", "-45" o "(45.00)". */
export function leerMonto(valor: Celda): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? Math.round(valor * 100) : Number.NaN;
  if (typeof valor !== "string") return Number.NaN;
  let t = valor.trim().replace(/[$\s]/g, "").replace(/^MXN|MXN$/i, "");
  if (t === "" || t === "-") return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith("+")) t = t.slice(1);
  const centavos = aCentavos(t);
  if (centavos === null) return Number.NaN;
  return negativo ? -centavos : centavos;
}

const texto = (valor: Celda): string => {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).replace(/\s+/g, " ").trim();
};

/** Las filas de la hoja → movimientos. Las filas vacías se ignoran; las que
 * no se entienden van a `errores` con su número de fila y no se guardan. */
export function interpretarFilas(filas: Filas): LecturaExcel {
  const encabezados = buscarEncabezados(filas);
  if (!encabezados)
    return {
      movimientos: [],
      errores: [
        "No encontramos los encabezados. La primera fila debe decir Fecha, Descripción y Cargo / Abono (como en la plantilla).",
      ],
    };
  const col = encabezados.columnas;
  const celda = (fila: readonly Celda[], campo: Campo) => {
    const j = col.get(campo);
    return j === undefined ? null : fila[j];
  };

  const movimientos: MovimientoExcel[] = [];
  const errores: string[] = [];
  const vistos = new Map<string, number>();

  for (let i = encabezados.fila + 1; i < filas.length; i++) {
    const fila = filas[i];
    const numero = i + 1;
    if (fila.every((c) => texto(c) === "")) continue;
    if (movimientos.length >= MAXIMO_FILAS) {
      errores.push(`Solo se leen ${MAXIMO_FILAS.toLocaleString("es-MX")} movimientos por archivo; divide el resto en otro.`);
      break;
    }

    const fecha = leerFecha(celda(fila, "fecha"));
    const descripcion = texto(celda(fila, "descripcion")).slice(0, 500);
    if (fecha === null) {
      errores.push(`Fila ${numero}: la fecha "${texto(celda(fila, "fecha"))}" no es válida (usa DD/MM/AAAA).`);
      continue;
    }
    if (descripcion === "") {
      errores.push(`Fila ${numero}: falta la descripción.`);
      continue;
    }

    // Centavos con signo: negativo = cargo, como RenglonCrudo.
    let centavos: number | null;
    const cargo = leerMonto(celda(fila, "cargo"));
    const abono = leerMonto(celda(fila, "abono"));
    const monto = leerMonto(celda(fila, "monto"));
    if (Number.isNaN(cargo) || Number.isNaN(abono) || Number.isNaN(monto)) {
      errores.push(`Fila ${numero}: el monto no es un número.`);
      continue;
    }
    const conValor = [cargo, abono, monto].filter((v) => v !== null && v !== 0);
    if (conValor.length === 0) {
      errores.push(`Fila ${numero}: falta el monto.`);
      continue;
    }
    if (conValor.length > 1) {
      errores.push(`Fila ${numero}: tiene monto en Cargo y en Abono; deja solo uno.`);
      continue;
    }
    if (cargo) centavos = -Math.abs(cargo);
    else if (abono) centavos = Math.abs(abono);
    else {
      // Una sola columna Monto: con columna Tipo manda el tipo; sin ella
      // (exportaciones de bancos), negativo = gasto.
      const tipo = sinAcentos(texto(celda(fila, "tipo")));
      if (tipo.startsWith("cargo") || tipo.startsWith("gasto")) centavos = -Math.abs(monto!);
      else if (tipo.startsWith("abono") || tipo.startsWith("ingreso")) centavos = Math.abs(monto!);
      else if (!col.has("tipo") || (tipo === "" && monto! < 0)) centavos = monto!;
      else {
        // Nunca adivinar: un gasto sin tipo contado como ingreso descuadra todo.
        errores.push(
          tipo === ""
            ? `Fila ${numero}: falta el tipo; elige ${TIPO_GASTO} o ${TIPO_INGRESO}.`
            : `Fila ${numero}: el tipo "${texto(celda(fila, "tipo"))}" no se entiende; usa ${TIPO_GASTO} o ${TIPO_INGRESO}.`
        );
        continue;
      }
    }

    const tipo = centavos < 0 ? "cargo" : "abono";
    const montoTexto = deCentavos(Math.abs(centavos));
    // La llave del upsert NO lleva el número de fila: así, volver a subir el
    // archivo con filas nuevas o reordenadas no duplica las que ya estaban.
    const base = `${PREFIJO_EXCEL}${fecha} | ${descripcion} | ${montoTexto} | ${tipo}`;
    const ocurrencia = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, ocurrencia);
    movimientos.push({
      fila: numero,
      fecha,
      descripcion,
      monto: montoTexto,
      tipo,
      pagina: 0,
      linea_cruda: ocurrencia === 1 ? base : `${base} (${ocurrencia})`,
      tarjeta: null,
      categoria: texto(celda(fila, "categoria")).slice(0, 100) || null,
      comercio: texto(celda(fila, "comercio")).slice(0, 100) || null,
    });
  }
  if (movimientos.length === 0 && errores.length === 0)
    errores.push("La hoja no tiene movimientos debajo de los encabezados.");
  return { movimientos, errores };
}

/** CSV → filas (comillas dobles, separador coma, punto y coma o tabulador). */
export function filasDeCsv(contenido: string): string[][] {
  const textoCsv = contenido.replace(/^﻿/, "");
  const primera = textoCsv.split(/\r?\n/, 1)[0] ?? "";
  const separador = [",", ";", "\t"].reduce((a, b) => (primera.split(b).length > primera.split(a).length ? b : a));
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < textoCsv.length; i++) {
    const c = textoCsv[i];
    if (entreComillas) {
      if (c === '"' && textoCsv[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === separador) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && textoCsv[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  // "Exportar mis datos" protege con un apóstrofo los textos que empiezan con
  // = + - @ (para que Excel no los ejecute); aquí se quita.
  return filas.map((f) => f.map((v) => v.replace(/^'(?=[=+\-@])/, "")));
}

export function esArchivoDeTabla(nombre: string): boolean {
  return /\.(xlsx|csv)$/i.test(nombre);
}

/** Lee un .xlsx (la hoja "Movimientos", o la primera) o un .csv. */
export async function leerArchivoTabla(archivo: File): Promise<LecturaExcel> {
  if (/\.csv$/i.test(archivo.name)) return interpretarFilas(filasDeCsv(await archivo.text()));
  const { default: leerExcel } = await import("read-excel-file/universal");
  const hojas = await leerExcel(await archivo.arrayBuffer());
  const hoja =
    hojas.find((h) => sinAcentos(h.sheet) === sinAcentos(HOJA_MOVIMIENTOS)) ??
    hojas.find((h) => !/^instrucciones/i.test(sinAcentos(h.sheet))) ??
    hojas[0];
  return interpretarFilas((hoja?.data ?? []) as unknown as Filas);
}

