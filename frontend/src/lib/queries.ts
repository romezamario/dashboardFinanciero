import { supabase } from "./supabase";
import type { Transaccion } from "./types";

export async function obtenerTransacciones(): Promise<Transaccion[]> {
  const { data, error } = await supabase
    .from("transacciones")
    .select(
      `id, fecha, descripcion, monto, tipo, saldo,
       categorias ( nombre ),
       documentos ( cuentas ( alias, bancos ( nombre ) ) )`
    )
    .order("fecha", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as Transaccion[];
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
    const nombre = t.categorias?.nombre ?? "Sin categoría";
    porCategoria.set(nombre, (porCategoria.get(nombre) ?? 0) + t.monto);
  }

  return Array.from(porCategoria.entries())
    .map(([categoria, total]) => ({ categoria, total }))
    .sort((a, b) => b.total - a.total);
}

export interface PuntoSaldo {
  fecha: string;
  [cuenta: string]: string | number; // una clave por alias de cuenta
}

export function agruparTendenciaSaldo(transacciones: Transaccion[]): {
  puntos: PuntoSaldo[];
  cuentas: string[];
} {
  const cuentas = Array.from(
    new Set(
      transacciones
        .filter((t) => t.saldo !== null)
        .map((t) => t.documentos.cuentas.alias)
    )
  );

  const puntos = transacciones
    .filter((t) => t.saldo !== null)
    .map((t) => ({
      fecha: t.fecha,
      [t.documentos.cuentas.alias]: t.saldo as number,
    }));

  return { puntos, cuentas };
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
