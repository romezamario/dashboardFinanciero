// De las páginas de un PDF a movimientos listos para guardar: detectar el
// banco, leer, normalizar (el equivalente de transform/transformador.py) y,
// si no se pudo leer, preparar la muestra anonimizada. Sin red ni React:
// probado en procesar.test.ts.

import { anonimizar } from "./anonimizar";
import { lectorBanamex } from "./banamex";
import { lectorBanamexTdc } from "./banamexTdc";
import { aCentavos, deCentavos, type Lector, type Paginas, type RenglonCrudo } from "./comun";
import { lectorInvexTdc } from "./invexTdc";

export const LECTORES: readonly Lector[] = [lectorBanamex, lectorBanamexTdc, lectorInvexTdc];

/** Tope del texto anonimizado que se manda como muestra (la tabla lo exige). */
export const MAXIMO_MUESTRA = 200_000;

export interface MovimientoImportado {
  fecha: string; // AAAA-MM-DD
  descripcion: string;
  monto: string; // sin signo, "1234.56"
  tipo: "cargo" | "abono";
  pagina: number;
  linea_cruda: string;
  tarjeta: string | null;
}

export type ResultadoImportacion =
  | {
      reconocido: true;
      banco: string;
      alias: string | null;
      ultimos4: string | null;
      movimientos: MovimientoImportado[];
      advertencias: string[];
      /** Texto anonimizado, por si el cliente quiere mandar muestra aunque se
       * haya leído (p. ej. le faltan movimientos). */
      muestra: string;
      paginas: number;
    }
  | {
      reconocido: false;
      motivo: "sin-texto" | "banco-desconocido" | "sin-movimientos";
      banco: string | null;
      muestra: string;
      paginas: number;
    };

/** Exactamente un lector debe reconocerlo; ninguno o varios = no sabemos. */
export function detectarLector(paginas: Paginas, lectores: readonly Lector[] = LECTORES): Lector | null {
  const candidatos = lectores.filter((l) => {
    try {
      return l.reconoce(paginas);
    } catch {
      return false;
    }
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

function fechaIso(ddmmaaaa: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ddmmaaaa.trim());
  if (!m) return null;
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Normaliza los renglones. Dos renglones con la misma (página, línea) —p. ej.
 * dos casetas iguales el mismo día— reciben " (2)", " (3)"… en orden de
 * aparición, igual que _desambiguar_renglones_duplicados: es la llave del
 * upsert, y así reimportar el mismo PDF no duplica nada. */
export function normalizar(renglones: readonly RenglonCrudo[]): { movimientos: MovimientoImportado[]; errores: string[] } {
  const vistos = new Map<string, number>();
  const movimientos: MovimientoImportado[] = [];
  const errores: string[] = [];
  for (const r of renglones) {
    const clave = `${r.pagina}\u0000${r.lineaCruda}`;
    const ocurrencia = (vistos.get(clave) ?? 0) + 1;
    vistos.set(clave, ocurrencia);
    const linea = ocurrencia === 1 ? r.lineaCruda : `${r.lineaCruda} (${ocurrencia})`;

    const fecha = fechaIso(r.fecha);
    const centavos = aCentavos(r.monto);
    if (fecha === null || centavos === null) {
      errores.push(`Página ${r.pagina}: no se pudo leer la fecha o el monto de: ${r.lineaCruda}`);
      continue;
    }
    movimientos.push({
      fecha,
      descripcion: r.descripcion.trim(),
      monto: deCentavos(Math.abs(centavos)),
      tipo: centavos < 0 ? "cargo" : "abono",
      pagina: r.pagina,
      linea_cruda: linea,
      tarjeta: r.tarjeta,
    });
  }
  return { movimientos, errores };
}

export function muestraAnonimizada(paginas: Paginas): string {
  return paginas
    .map((lineas, i) => `--- Página ${i + 1} ---\n${anonimizar(lineas.join("\n"))}`)
    .join("\n\n")
    .slice(0, MAXIMO_MUESTRA);
}

export function procesarPaginas(paginas: Paginas, lectores: readonly Lector[] = LECTORES): ResultadoImportacion {
  const muestra = muestraAnonimizada(paginas);
  const total = paginas.length;
  if (paginas.every((lineas) => lineas.length === 0))
    return { reconocido: false, motivo: "sin-texto", banco: null, muestra, paginas: total };

  const lector = detectarLector(paginas, lectores);
  if (!lector) return { reconocido: false, motivo: "banco-desconocido", banco: null, muestra, paginas: total };

  const lectura = lector.leer(paginas);
  const { movimientos, errores } = normalizar(lectura.renglones);
  if (movimientos.length === 0) return { reconocido: false, motivo: "sin-movimientos", banco: lector.banco, muestra, paginas: total };

  const { alias, ultimos4 } = lector.cuenta(paginas);
  return {
    reconocido: true,
    banco: lector.banco,
    alias,
    ultimos4,
    movimientos,
    advertencias: [...lectura.advertencias, ...errores],
    muestra,
    paginas: total,
  };
}

/** Totales en centavos, para mostrar antes de guardar. */
export function totales(movimientos: readonly MovimientoImportado[]): { cargos: number; abonos: number } {
  let cargos = 0;
  let abonos = 0;
  for (const m of movimientos) {
    const c = aCentavos(m.monto) ?? 0;
    if (m.tipo === "cargo") cargos += c;
    else abonos += c;
  }
  return { cargos, abonos };
}

export function periodo(movimientos: readonly MovimientoImportado[]): { inicio: string; fin: string } | null {
  if (movimientos.length === 0) return null;
  const fechas = movimientos.map((m) => m.fecha).sort();
  return { inicio: fechas[0], fin: fechas[fechas.length - 1] };
}
