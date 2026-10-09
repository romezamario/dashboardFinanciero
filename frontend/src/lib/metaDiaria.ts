// Meta de gasto diario y promedio por semana del calendario de "Gastos
// recientes" (vista por correo y por estado de cuenta).

/** Meta del usuario: gastar en promedio $1,000 al día (en pesos). */
export const META_GASTO_DIARIO = 1000;

/** Fecha de hoy en la zona del navegador, como ISO (no UTC: de noche en CDMX
 * UTC ya es "mañana"). */
export function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DIA_MS = 86_400_000;
const aMs = (fecha: string) => Date.parse(`${fecha}T00:00:00Z`);
const aIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Los 7 días (domingo a sábado, como el calendario) de la semana de `fecha`.
 * En UTC para que la zona horaria del navegador no corra ningún día. */
export function diasDeLaSemana(fecha: string): string[] {
  const ms = aMs(fecha);
  const domingo = ms - new Date(ms).getUTCDay() * DIA_MS;
  return Array.from({ length: 7 }, (_, i) => aIso(domingo + i * DIA_MS));
}

export interface ResumenPromedio {
  /** Primer y último día CONTADOS (un periodo a medias no los cubre todos). */
  desde: string;
  hasta: string;
  /** Días que entran al promedio. */
  dias: number;
  /** Centavos gastados en esos días. */
  total: number;
  /** Centavos por día (total / dias), redondeado. */
  promedio: number;
}

/**
 * Promedio de gasto diario sobre `candidatos` (las fechas ISO de una semana o
 * de un mes). Cuentan los días entre `primera` (el primer día con datos) y
 * `corte` (hasta dónde se conoce el gasto: hoy en los correos, la última fecha
 * cargada en los estados de cuenta): un día sin movimientos DENTRO de ese
 * rango es un día de $0 y baja el promedio, pero uno fuera de él no se sabe --
 * contarlo como $0 haría ver la semana o el mes en curso (o lo que sigue al
 * último estado de cuenta) mucho más barato de lo que es. Sin ningún día
 * contable devuelve null. `totales`: centavos por fecha ISO (solo hace falta
 * que estén los días con gasto).
 */
export function resumenDeDias(
  candidatos: string[],
  totales: Map<string, number>,
  primera: string,
  corte: string
): ResumenPromedio | null {
  const contables = candidatos.filter((d) => d >= primera && d <= corte).sort();
  if (contables.length === 0) return null;
  const total = contables.reduce((suma, d) => suma + (totales.get(d) ?? 0), 0);
  return {
    desde: contables[0],
    hasta: contables[contables.length - 1],
    dias: contables.length,
    total,
    promedio: Math.round(total / contables.length),
  };
}

/** Promedio diario de la semana (domingo a sábado) de `fecha`; ver `resumenDeDias`. */
export function resumenDeSemana(
  fecha: string,
  totales: Map<string, number>,
  primera: string,
  corte: string
): ResumenPromedio | null {
  return resumenDeDias(diasDeLaSemana(fecha), totales, primera, corte);
}

/** Todos los días ISO del mes "YYYY-MM". */
export function diasDelMes(mes: string): string[] {
  const [anio, m] = mes.split("-").map(Number);
  const cantidad = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  return Array.from({ length: cantidad }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);
}

/** Promedio diario del mes "YYYY-MM"; ver `resumenDeDias`. */
export function resumenDeMes(
  mes: string,
  totales: Map<string, number>,
  primera: string,
  corte: string
): ResumenPromedio | null {
  return resumenDeDias(diasDelMes(mes), totales, primera, corte);
}
