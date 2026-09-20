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

export function categoriaDe(t: Transaccion): string {
  return t.categorias?.nombre ?? SIN_CATEGORIA;
}

/**
 * Quita del set por completo cualquier transacción cuya categoría esté en
 * `categoriasOcultas` -- a diferencia de `aplicarFiltros` (que AISLA una
 * sola categoría, estilo Power BI "clic para filtrar"), esto es lo inverso:
 * varias categorías a la vez, escondidas de TODO (KPIs, gráficas, tabla),
 * incluyendo su propia gráfica de origen (Gasto por categoría no debe
 * seguir mostrando una barra que el usuario pidió ocultar). Se aplica antes
 * que `aplicarFiltros` en `Dashboard`, como un filtro previo sobre qué
 * datos existen para el resto del dashboard, no como una dimensión más del
 * cross-filter.
 */
export function ocultarCategorias(
  transacciones: Transaccion[],
  categoriasOcultas: Set<string>
): Transaccion[] {
  if (categoriasOcultas.size === 0) return transacciones;
  return transacciones.filter((t) => !categoriasOcultas.has(categoriaDe(t)));
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

/**
 * Coincidencia por substring, insensible a mayúsculas, sobre la descripción
 * cruda -- es la búsqueda que alimenta el editor masivo de categoría/comercio
 * (ver `EditorTransacciones.tsx`). Texto vacío no matchea nada a propósito,
 * para no listar todas las transacciones del usuario por accidente.
 */
export function buscarPorDescripcion(
  transacciones: Transaccion[],
  texto: string
): Transaccion[] {
  const normalizado = texto.trim().toUpperCase();
  if (!normalizado) return [];
  return transacciones.filter((t) => t.descripcion.toUpperCase().includes(normalizado));
}

/** Busca una categoría por nombre (RLS ya la acota al usuario); si no
 * existe la crea. Mismo find-or-create que usa sync/sincronizador.py del
 * lado de Python -- aquí hace falta porque `categoria_id` es un FK, no
 * texto libre, así que escribir una categoría nueva desde el frontend
 * requiere resolver (o crear) su fila en `categorias` primero. */
async function buscarOCrearCategoriaId(nombre: string): Promise<string> {
  const { data: existente, error: errorSelect } = await supabase
    .from("categorias")
    .select("id")
    .eq("nombre", nombre)
    .maybeSingle();
  if (errorSelect) throw errorSelect;
  if (existente) return existente.id as string;

  const { data: creada, error: errorInsert } = await supabase
    .from("categorias")
    .insert({ nombre })
    .select("id")
    .single();
  if (errorInsert) throw errorInsert;
  return creada.id as string;
}

/**
 * Edición masiva: aplica una nueva categoría y/o comercio a los `id` dados.
 * Un campo ausente en `cambios` significa "no tocar ese campo" -- no hay
 * forma de "vaciar" categoría/comercio desde aquí, solo de reasignarlos (no
 * se pidió esa función; si hace falta, agrega un `null` explícito aparte).
 * RLS ya garantiza que el update solo puede tocar filas del propio usuario,
 * así que no hace falta re-validar ownership aquí.
 */
export async function actualizarCategoriaYComercio(
  ids: string[],
  cambios: { categoria?: string; comercio?: string }
): Promise<void> {
  if (ids.length === 0) return;

  const payload: Record<string, unknown> = {};
  if (cambios.categoria) {
    payload.categoria_id = await buscarOCrearCategoriaId(cambios.categoria);
  }
  if (cambios.comercio) {
    payload.comercio = cambios.comercio;
  }
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("transacciones").update(payload).in("id", ids);
  if (error) throw error;
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
