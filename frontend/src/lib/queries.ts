import { supabase } from "./supabase";
import type { Transaccion } from "./types";

export async function obtenerTransacciones(): Promise<Transaccion[]> {
  const { data, error } = await supabase
    .from("transacciones")
    .select(
      `id, fecha, descripcion, monto, tipo, saldo, comercio,
       categorias ( nombre ),
       documentos ( cuentas ( alias, bancos ( nombre ) ) )`
    )
    .order("fecha", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as Transaccion[];
}

export interface Filtros {
  mes?: string;
  categoria?: string;
  comercio?: string;
}

/** Nombre de categoría que usa el resto del código para "sin categoría". */
export const SIN_CATEGORIA = "Sin categoría";

function categoriaDe(t: Transaccion): string {
  return t.categorias?.nombre ?? SIN_CATEGORIA;
}

/**
 * Filtra transacciones por cross-filter estilo Power BI: cada dimensión
 * activa en `filtros` se aplica, EXCEPTO la que esté en `excluir` — así una
 * gráfica puede seguir mostrando todas sus propias opciones (para poder
 * cambiar la selección) mientras respeta los filtros que vienen de las
 * demás gráficas.
 */
export function aplicarFiltros(
  transacciones: Transaccion[],
  filtros: Filtros,
  excluir?: keyof Filtros
): Transaccion[] {
  return transacciones.filter((t) => {
    if (filtros.mes && excluir !== "mes" && t.fecha.slice(0, 7) !== filtros.mes) {
      return false;
    }
    if (
      filtros.categoria &&
      excluir !== "categoria" &&
      categoriaDe(t) !== filtros.categoria
    ) {
      return false;
    }
    if (
      filtros.comercio &&
      excluir !== "comercio" &&
      t.comercio !== filtros.comercio
    ) {
      return false;
    }
    return true;
  });
}

export interface PuntoIngresoGasto {
  mes: string; // "2026-06"
  ingresos: number;
  gastos: number;
}

export function agruparIngresosGastosPorMes(
  transacciones: Transaccion[]
): PuntoIngresoGasto[] {
  const porMes = new Map<string, PuntoIngresoGasto>();

  for (const t of transacciones) {
    const mes = t.fecha.slice(0, 7);
    if (!porMes.has(mes)) {
      porMes.set(mes, { mes, ingresos: 0, gastos: 0 });
    }
    const punto = porMes.get(mes)!;
    if (t.tipo === "abono") {
      punto.ingresos += t.monto;
    } else {
      punto.gastos += t.monto;
    }
  }

  return Array.from(porMes.values()).sort((a, b) => a.mes.localeCompare(b.mes));
}

export interface PuntoCategoria {
  categoria: string;
  total: number;
}

export function agruparGastoPorCategoria(
  transacciones: Transaccion[]
): PuntoCategoria[] {
  const porCategoria = new Map<string, number>();

  for (const t of transacciones) {
    if (t.tipo !== "cargo") continue;
    const nombre = categoriaDe(t);
    porCategoria.set(nombre, (porCategoria.get(nombre) ?? 0) + t.monto);
  }

  return Array.from(porCategoria.entries())
    .map(([categoria, total]) => ({ categoria, total }))
    .sort((a, b) => b.total - a.total);
}

export interface PuntoComercio {
  comercio: string;
  total: number;
}

export function agruparGastoPorComercio(
  transacciones: Transaccion[]
): PuntoComercio[] {
  // A diferencia de categoría, comercio no tiene un fallback "Sin comercio"
  // -- es opcional por diseño (solo lo asignan las reglas que lo definen
  // explícitamente), así que una transacción sin comercio simplemente no
  // participa en este agrupado en vez de inflar un bucket poco informativo.
  const porComercio = new Map<string, number>();

  for (const t of transacciones) {
    if (t.tipo !== "cargo" || !t.comercio) continue;
    porComercio.set(t.comercio, (porComercio.get(t.comercio) ?? 0) + t.monto);
  }

  return Array.from(porComercio.entries())
    .map(([comercio, total]) => ({ comercio, total }))
    .sort((a, b) => b.total - a.total);
}

export interface Totales {
  saldoActual: number | null;
  ingresosMes: number;
  gastosMes: number;
}

export function calcularTotales(transacciones: Transaccion[]): Totales {
  const conSaldo = transacciones.filter((t) => t.saldo !== null);
  const saldoActual =
    conSaldo.length > 0 ? (conSaldo[conSaldo.length - 1].saldo as number) : null;

  const mesActual = new Date().toISOString().slice(0, 7);
  let ingresosMes = 0;
  let gastosMes = 0;
  for (const t of transacciones) {
    if (t.fecha.slice(0, 7) !== mesActual) continue;
    if (t.tipo === "abono") ingresosMes += t.monto;
    else gastosMes += t.monto;
  }

  return { saldoActual, ingresosMes, gastosMes };
}
