import { supabase } from "./supabase";
import type { Transaccion } from "./types";

/** PostgREST devuelve como máximo 1000 filas por consulta si no se pagina
 * explícitamente -- por debajo de ese límite `obtenerTransacciones` nunca
 * lo notó, pero al pasar de 1000 transacciones totales empezó a devolver
 * solo las 1000 más antiguas (orden ascendente por fecha), descartando en
 * silencio las más recientes. Se pagina con `.range()` hasta que una
 * página llega incompleta. */
const TAMANO_PAGINA = 1000;

export async function obtenerTransacciones(): Promise<Transaccion[]> {
  const todas: Transaccion[] = [];
  let desde = 0;

  while (true) {
    const { data, error } = await supabase
      .from("transacciones")
      .select(
        `id, fecha, descripcion, monto, tipo, saldo, comercio, tarjeta,
         categorias ( nombre ),
         eventos ( nombre ),
         documentos ( id, cuentas ( id, alias, bancos ( nombre ) ) )`
      )
      .order("fecha", { ascending: true })
      .range(desde, desde + TAMANO_PAGINA - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    todas.push(...(data as unknown as Transaccion[]));
    if (data.length < TAMANO_PAGINA) break;
    desde += TAMANO_PAGINA;
  }

  return todas;
}

export interface Filtros {
  mes?: string;
  categoria?: string;
  comercio?: string;
  cuenta?: string;
  tarjeta?: string;
  evento?: string;
}

/** Nombre de categoría que usa el resto del código para "sin categoría". */
export const SIN_CATEGORIA = "Sin categoría";

export function categoriaDe(t: Transaccion): string {
  return t.categorias?.nombre ?? SIN_CATEGORIA;
}

/** A diferencia de categoría, un evento (viaje, fiesta) es opcional por
 * diseño -- la mayoría de las transacciones no pertenecen a ninguno, así
 * que no hay un fallback "Sin evento" (mismo criterio que comercio). */
export function eventoDe(t: Transaccion): string | null {
  return t.eventos?.nombre ?? null;
}

/** Alias de la cuenta (ver `cuentas.alias`) -- siempre presente, a
 * diferencia de categoría/comercio, porque toda transacción viene de un
 * documento que ya requiere alias/últimos_4 antes de poder sincronizarse
 * (ver Sincronizador en CLAUDE.md). */
export function cuentaDe(t: Transaccion): string {
  return t.documentos.cuentas.alias;
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
    if (filtros.cuenta && excluir !== "cuenta" && cuentaDe(t) !== filtros.cuenta) {
      return false;
    }
    if (filtros.tarjeta && excluir !== "tarjeta" && t.tarjeta !== filtros.tarjeta) {
      return false;
    }
    if (filtros.evento && excluir !== "evento" && eventoDe(t) !== filtros.evento) {
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

  // Rellena los meses sin ninguna transacción con $0 entre el primero y el
  // último mes que sí tienen datos -- si no, el eje del tiempo se comprime
  // (un mes sin movimientos desaparece del eje en vez de mostrarse como un
  // hueco) y la gráfica sugiere continuidad donde en realidad hay meses
  // faltantes.
  const mesesConDatos = Array.from(porMes.keys()).sort();
  if (mesesConDatos.length > 0) {
    const [anioInicio, mesInicio] = mesesConDatos[0].split("-").map(Number);
    const [anioFin, mesFin] = mesesConDatos[mesesConDatos.length - 1].split("-").map(Number);
    const indiceFin = anioFin * 12 + (mesFin - 1);

    let anio = anioInicio;
    let mes = mesInicio - 1; // 0-indexado, como anoMes espera
    while (anio * 12 + mes <= indiceFin) {
      const clave = anoMes(anio, mes);
      if (!porMes.has(clave)) {
        porMes.set(clave, { mes: clave, ingresos: 0, gastos: 0 });
      }
      mes += 1;
      if (mes > 11) {
        mes = 0;
        anio += 1;
      }
    }
  }

  return Array.from(porMes.values()).sort((a, b) => a.mes.localeCompare(b.mes));
}

export interface PuntoCategoria {
  categoria: string;
  ingresos: number;
  gastos: number;
}

/**
 * Antes solo sumaba "cargo" (gasto); ahora acumula ambos tipos por
 * categoría -- una categoría puede tener ingresos (p. ej. "Transferencia
 * recibida") y gastos a la vez. El top-8 (aplicado en el componente) ya no
 * ordena solo por gasto sino por la magnitud combinada
 * (ingresos + gastos), para no dejar fuera una categoría que es
 * mayormente de ingresos.
 */
export function agruparPorCategoria(transacciones: Transaccion[]): PuntoCategoria[] {
  const porCategoria = new Map<string, { ingresos: number; gastos: number }>();

  for (const t of transacciones) {
    const nombre = categoriaDe(t);
    const acumulado = porCategoria.get(nombre) ?? { ingresos: 0, gastos: 0 };
    if (t.tipo === "abono") acumulado.ingresos += t.monto;
    else acumulado.gastos += t.monto;
    porCategoria.set(nombre, acumulado);
  }

  return Array.from(porCategoria.entries())
    .map(([categoria, { ingresos, gastos }]) => ({ categoria, ingresos, gastos }))
    .sort((a, b) => b.ingresos + b.gastos - (a.ingresos + a.gastos));
}

export interface PuntoComercio {
  comercio: string;
  ingresos: number;
  gastos: number;
}

export function agruparPorComercio(transacciones: Transaccion[]): PuntoComercio[] {
  // A diferencia de categoría, comercio no tiene un fallback "Sin comercio"
  // -- es opcional por diseño (solo lo asignan las reglas que lo definen
  // explícitamente), así que una transacción sin comercio simplemente no
  // participa en este agrupado en vez de inflar un bucket poco informativo.
  // Acumula ingresos y gastos por separado -- un comercio como "Pago TDC
  // Beyond" solo aparece del lado de ingresos (es un abono), mientras que
  // uno de compra normal solo del lado de gastos.
  const porComercio = new Map<string, { ingresos: number; gastos: number }>();

  for (const t of transacciones) {
    if (!t.comercio) continue;
    const acumulado = porComercio.get(t.comercio) ?? { ingresos: 0, gastos: 0 };
    if (t.tipo === "abono") acumulado.ingresos += t.monto;
    else acumulado.gastos += t.monto;
    porComercio.set(t.comercio, acumulado);
  }

  return Array.from(porComercio.entries())
    .map(([comercio, { ingresos, gastos }]) => ({ comercio, ingresos, gastos }))
    .sort((a, b) => b.ingresos + b.gastos - (a.ingresos + a.gastos));
}

export interface PuntoEvento {
  evento: string;
  ingresos: number;
  gastos: number;
}

/** Mismo patrón que `agruparPorComercio`: un evento es opcional (solo lo
 * asignan manualmente desde `EventosTab`), así que no hay un fallback "Sin
 * evento" -- las transacciones sin evento simplemente no participan. */
export function agruparPorEvento(transacciones: Transaccion[]): PuntoEvento[] {
  const porEvento = new Map<string, { ingresos: number; gastos: number }>();

  for (const t of transacciones) {
    const evento = eventoDe(t);
    if (!evento) continue;
    const acumulado = porEvento.get(evento) ?? { ingresos: 0, gastos: 0 };
    if (t.tipo === "abono") acumulado.ingresos += t.monto;
    else acumulado.gastos += t.monto;
    porEvento.set(evento, acumulado);
  }

  return Array.from(porEvento.entries())
    .map(([evento, { ingresos, gastos }]) => ({ evento, ingresos, gastos }))
    .sort((a, b) => b.ingresos + b.gastos - (a.ingresos + a.gastos));
}

export interface Promedios {
  ingresosPromedio3m: number;
  gastosPromedio3m: number;
  ingresosPromedio12m: number;
  gastosPromedio12m: number;
}

function anoMes(anio: number, mes: number): string {
  // `mes` es 0-indexado como Date.getMonth(); normaliza el acarreo de año
  // antes de formatear, para no depender de Date/toISOString (que convierte
  // a UTC y puede correr el día -- y con día 1, el mes -- para zonas con
  // offset positivo).
  let a = anio;
  let m = mes;
  while (m < 0) {
    m += 12;
    a -= 1;
  }
  return `${a}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Suma ingresos/gastos de una ventana de calendario fija: los
 * `cantidadMeses` meses completos ANTERIORES al mes en curso. El mes en
 * curso se excluye porque los estados de cuenta llegan a mes vencido -- sus
 * datos siempre están incompletos y bajarían el promedio.
 */
function sumaPorTipoUltimosMeses(
  transacciones: Transaccion[],
  cantidadMeses: number
): { ingresos: number; gastos: number } {
  const ahora = new Date();
  const mesInicio = anoMes(ahora.getFullYear(), ahora.getMonth() - cantidadMeses);
  const mesActual = anoMes(ahora.getFullYear(), ahora.getMonth());

  let ingresos = 0;
  let gastos = 0;
  for (const t of transacciones) {
    const mes = t.fecha.slice(0, 7);
    if (mes < mesInicio || mes >= mesActual) continue;
    if (t.tipo === "abono") ingresos += t.monto;
    else gastos += t.monto;
  }
  return { ingresos, gastos };
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

/** Mismo find-or-create que `buscarOCrearCategoriaId`, para `eventos` --
 * `evento_id` también es un FK, así que escribir "Viaje a Cancún" desde el
 * frontend necesita resolver (o crear) su fila en `eventos` primero, para
 * que dos transacciones con el mismo nombre de evento de verdad compartan
 * la misma fila en vez de fragmentarse por variaciones de texto. */
async function buscarOCrearEventoId(nombre: string): Promise<string> {
  const { data: existente, error: errorSelect } = await supabase
    .from("eventos")
    .select("id")
    .eq("nombre", nombre)
    .maybeSingle();
  if (errorSelect) throw errorSelect;
  if (existente) return existente.id as string;

  const { data: creado, error: errorInsert } = await supabase
    .from("eventos")
    .insert({ nombre })
    .select("id")
    .single();
  if (errorInsert) throw errorInsert;
  return creado.id as string;
}

/**
 * Edición masiva: aplica una nueva categoría, comercio y/o evento a los
 * `id` dados. Un campo ausente en `cambios` significa "no tocar ese campo"
 * -- no hay forma de "vaciar" ninguno desde aquí, solo de reasignarlos (no
 * se pidió esa función; si hace falta, agrega un `null` explícito aparte).
 * RLS ya garantiza que el update solo puede tocar filas del propio usuario,
 * así que no hace falta re-validar ownership aquí.
 */
export async function actualizarCategoriaComercioYEvento(
  ids: string[],
  cambios: { categoria?: string; comercio?: string; evento?: string }
): Promise<void> {
  if (ids.length === 0) return;

  const payload: Record<string, unknown> = {};
  if (cambios.categoria) {
    payload.categoria_id = await buscarOCrearCategoriaId(cambios.categoria);
  }
  if (cambios.comercio) {
    payload.comercio = cambios.comercio;
  }
  if (cambios.evento) {
    payload.evento_id = await buscarOCrearEventoId(cambios.evento);
  }
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("transacciones").update(payload).in("id", ids);
  if (error) throw error;
}

export interface ImpactoCambioDeCuenta {
  documentoIds: string[];
  totalTransaccionesAfectadas: number;
}

/**
 * A diferencia de categoría/comercio (columnas de `transacciones`),
 * `cuenta_id` vive en `documentos` -- cada transacción hereda la cuenta de
 * su documento (estado de cuenta), no la tiene individualmente. Reasignar
 * la cuenta de una transacción seleccionada implica reasignar el
 * documento *completo*, lo que también mueve cualquier otra transacción
 * de ese mismo documento aunque no esté seleccionada. Esta función calcula
 * ese impacto real (documentos únicos + total de transacciones afectadas,
 * incluidas las no seleccionadas) para poder avisarle al usuario antes de
 * aplicar el cambio.
 */
export function calcularImpactoCambioDeCuenta(
  transacciones: Transaccion[],
  idsSeleccionados: string[]
): ImpactoCambioDeCuenta {
  const seleccionados = new Set(idsSeleccionados);
  const documentoIds = new Set<string>();
  for (const t of transacciones) {
    if (seleccionados.has(t.id)) documentoIds.add(t.documentos.id);
  }
  const totalTransaccionesAfectadas = transacciones.filter((t) =>
    documentoIds.has(t.documentos.id)
  ).length;
  return { documentoIds: Array.from(documentoIds), totalTransaccionesAfectadas };
}

/**
 * Reasigna `cuenta_id` de los documentos dados -- ver
 * `calcularImpactoCambioDeCuenta` para el porqué esto mueve el documento
 * completo y no transacciones individuales. Solo elige entre cuentas ya
 * existentes (no hay find-or-create como en categoría): crear una cuenta
 * nueva requiere banco + últimos 4 dígitos, que no tiene sentido pedir
 * como texto libre en este editor -- para eso está la app de escritorio.
 */
export async function actualizarCuentaDeDocumentos(
  documentoIds: string[],
  cuentaId: string
): Promise<void> {
  if (documentoIds.length === 0) return;
  const { error } = await supabase
    .from("documentos")
    .update({ cuenta_id: cuentaId })
    .in("id", documentoIds);
  if (error) throw error;
}

/**
 * Promedio mensual de ingresos/gastos sobre los últimos 3 y últimos 12
 * meses de calendario completos (sin contar el mes en curso, ver
 * `sumaPorTipoUltimosMeses`). Se divide siempre entre
 * `cantidadMeses` fija, no entre los meses que realmente tienen
 * transacciones -- un mes sin movimientos es un mes real con $0, no un dato
 * faltante que deba excluirse del promedio.
 */
export function calcularPromedios(transacciones: Transaccion[]): Promedios {
  const ultimos3 = sumaPorTipoUltimosMeses(transacciones, 3);
  const ultimos12 = sumaPorTipoUltimosMeses(transacciones, 12);
  return {
    ingresosPromedio3m: ultimos3.ingresos / 3,
    gastosPromedio3m: ultimos3.gastos / 3,
    ingresosPromedio12m: ultimos12.ingresos / 12,
    gastosPromedio12m: ultimos12.gastos / 12,
  };
}
