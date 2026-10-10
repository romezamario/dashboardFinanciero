import { supabase } from "./supabase";
import type { Transaccion } from "./types";

/** PostgREST devuelve como máximo 1000 filas por consulta: más allá hay que
 * paginar explícitamente (al pasar de 1000 transacciones, sin paginar, se
 * descartaban en silencio las más recientes). */
const TAMANO_PAGINA = 1000;

/** Los errores de PostgREST son objetos `{ message, code, ... }`; quien los
 * atrapa espera un `Error` para mostrar su mensaje. */
function comoError(error: unknown): Error {
  if (error instanceof Error) return error;
  const mensaje = (error as { message?: unknown } | null)?.message;
  return new Error(typeof mensaje === "string" ? mensaje : String(error));
}

type RespuestaPagina = PromiseLike<{
  data: unknown[] | null;
  error: unknown;
  count?: number | null;
}>;

/**
 * Trae TODAS las filas de una consulta paginada con `.range()`. `pagina`
 * debe ordenar por una llave total (p. ej. fecha **e id**): con solo fecha,
 * Postgres no garantiza el orden entre filas del mismo día y el paginado por
 * offset podía repetir una fila y saltarse otra en el borde de página.
 *
 * La primera página pide un conteo *estimado* (`count: "estimated"`, barato:
 * exacto hasta el máximo de filas de PostgREST y por estadísticas del
 * planificador más allá, en vez de un `COUNT(*)` completo en cada carga) y
 * con él pide en PARALELO las páginas que probablemente faltan: esperarlas
 * en serie solo sumaba un round-trip por página. Como el estimado puede
 * quedarse corto, si la última página llegó llena se sigue pidiendo de una
 * en una hasta que llegue una incompleta. `Promise.all` respeta el orden del
 * arreglo, así que el orden final es el de la consulta.
 */
export async function obtenerTodasLasPaginas<T>(
  pagina: (desde: number, hasta: number, contar: boolean) => RespuestaPagina
): Promise<T[]> {
  const primera = await pagina(0, TAMANO_PAGINA - 1, true);
  if (primera.error) throw comoError(primera.error);
  const filas = (primera.data ?? []) as T[];
  if (filas.length < TAMANO_PAGINA) return filas;

  const estimadas = Math.max(0, Math.ceil(((primera.count ?? 0) - TAMANO_PAGINA) / TAMANO_PAGINA));
  let desde = TAMANO_PAGINA;
  const enParalelo = await Promise.all(
    Array.from({ length: estimadas }, (_, i) => {
      const inicio = desde + i * TAMANO_PAGINA;
      return pagina(inicio, inicio + TAMANO_PAGINA - 1, false);
    })
  );
  desde += estimadas * TAMANO_PAGINA;
  let ultimaLlena = true;
  for (const { data, error } of enParalelo) {
    if (error) throw comoError(error);
    const datos = (data ?? []) as T[];
    filas.push(...datos);
    ultimaLlena = datos.length === TAMANO_PAGINA;
  }
  while (ultimaLlena) {
    const { data, error } = await pagina(desde, desde + TAMANO_PAGINA - 1, false);
    if (error) throw comoError(error);
    const datos = (data ?? []) as T[];
    filas.push(...datos);
    ultimaLlena = datos.length === TAMANO_PAGINA;
    desde += TAMANO_PAGINA;
  }
  return filas;
}

/** Una fila de `transacciones` tal cual, con sus llaves foráneas en vez de
 * las relaciones anidadas: categoría, evento y documento (con su cuenta y
 * banco) se resuelven contra `Catalogos` en `armarTransacciones`. */
export interface FilaTransaccion {
  id: string;
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: "cargo" | "abono";
  saldo: number | null;
  comercio: string | null;
  tarjeta: string | null;
  categoria_id: string | null;
  evento_id: string | null;
  documento_id: string;
}

const COLUMNAS_TRANSACCION =
  "id, fecha, descripcion, monto, tipo, saldo, comercio, tarjeta, categoria_id, evento_id, documento_id";

/** Categorías, eventos y documentos (con cuenta y banco) por id. Son unas
 * decenas/cientos de filas: pedirlos aparte en vez de anidarlos en cada
 * transacción evita repetir el mismo `{"alias": ..., "bancos": {...}}` miles
 * de veces en la respuesta (era la mayor parte del JSON), y deja que todas
 * las transacciones de un documento compartan el mismo objeto. */
export interface Catalogos {
  categorias: Map<string, NonNullable<Transaccion["categorias"]>>;
  eventos: Map<string, NonNullable<Transaccion["eventos"]>>;
  documentos: Map<string, Transaccion["documentos"]>;
}

export interface DatosTransacciones {
  filas: FilaTransaccion[];
  catalogos: Catalogos;
}

function porId<T extends { id: string }, V>(filas: T[], valor: (fila: T) => V): Map<string, V> {
  return new Map(filas.map((f) => [f.id, valor(f)]));
}

export async function obtenerCatalogos(): Promise<Catalogos> {
  const [categorias, eventos, documentos] = await Promise.all([
    obtenerTodasLasPaginas<{ id: string; nombre: string }>((desde, hasta, contar) =>
      supabase
        .from("categorias")
        .select("id, nombre", contar ? { count: "estimated" } : undefined)
        .order("id")
        .range(desde, hasta)
    ),
    obtenerTodasLasPaginas<{ id: string; nombre: string }>((desde, hasta, contar) =>
      supabase
        .from("eventos")
        .select("id, nombre", contar ? { count: "estimated" } : undefined)
        .order("id")
        .range(desde, hasta)
    ),
    obtenerTodasLasPaginas<Transaccion["documentos"]>((desde, hasta, contar) =>
      supabase
        .from("documentos")
        .select("id, cuentas ( id, alias, bancos ( nombre ) )", contar ? { count: "estimated" } : undefined)
        .order("id")
        .range(desde, hasta)
    ),
  ]);
  return {
    categorias: porId(categorias, (c) => ({ nombre: c.nombre })),
    eventos: porId(eventos, (e) => ({ nombre: e.nombre })),
    documentos: porId(documentos, (d) => d),
  };
}

async function obtenerFilas(): Promise<FilaTransaccion[]> {
  return obtenerTodasLasPaginas<FilaTransaccion>((desde, hasta, contar) =>
    supabase
      .from("transacciones")
      .select(COLUMNAS_TRANSACCION, contar ? { count: "estimated" } : undefined)
      .order("fecha", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, hasta)
  );
}

/** Todo el historial más los catálogos, en paralelo. */
export async function obtenerDatosTransacciones(): Promise<DatosTransacciones> {
  const [filas, catalogos] = await Promise.all([obtenerFilas(), obtenerCatalogos()]);
  return { filas, catalogos };
}

/** Solo las filas con esos `id` -- para refrescar lo editado sin volver a
 * bajar todo el historial. */
export async function obtenerFilasPorIds(ids: string[]): Promise<FilaTransaccion[]> {
  const filas: FilaTransaccion[] = [];
  await porLotes(ids, async (lote) => {
    const respuesta = await supabase.from("transacciones").select(COLUMNAS_TRANSACCION).in("id", lote);
    if (!respuesta.error) filas.push(...((respuesta.data ?? []) as FilaTransaccion[]));
    return respuesta;
  });
  return filas;
}

/** `filas` con las de `nuevas` en lugar de las que tengan el mismo id (mismo
 * orden; una edición no cambia la fecha). */
export function reemplazarFilas(filas: FilaTransaccion[], nuevas: FilaTransaccion[]): FilaTransaccion[] {
  if (nuevas.length === 0) return filas;
  const porIdNueva = new Map(nuevas.map((f) => [f.id, f]));
  return filas.map((f) => porIdNueva.get(f.id) ?? f);
}

/** Arma la `Transaccion` con sus relaciones anidadas (la forma que usa todo
 * el frontend, la misma que devolvía PostgREST al anidar). Una fila cuyo
 * documento no está en el catálogo (no debería pasar: la RLS deja ver ambos
 * o ninguno) se omite en vez de romper `cuentaDe`. */
export function armarTransacciones(filas: FilaTransaccion[], catalogos: Catalogos): Transaccion[] {
  const resultado: Transaccion[] = [];
  for (const { categoria_id, evento_id, documento_id, ...campos } of filas) {
    const documentos = catalogos.documentos.get(documento_id);
    if (!documentos) continue;
    resultado.push({
      ...campos,
      categorias: (categoria_id && catalogos.categorias.get(categoria_id)) || null,
      eventos: (evento_id && catalogos.eventos.get(evento_id)) || null,
      documentos,
    });
  }
  return resultado;
}

/** Filtros por clic (cross-filter). El tiempo NO es parte de ellos: lo
 * maneja el periodo de la vista (`resolverPeriodo` en indicadores.ts), que
 * también fijan los clics en la gráfica de ingresos vs. gastos. */
export interface Filtros {
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
 * Mismo mecanismo que `ocultarCategorias`, pero para eventos: descarta por
 * completo las transacciones de los eventos elegidos (de TODO -- KPIs,
 * gráficas, tabla, no solo del detalle), a diferencia de `aplicarFiltros`
 * con `evento` (que AISLA un solo evento). Útil para un evento grande y
 * puntual (una boda, un viaje) que se quiere excluir de los indicadores de
 * salud financiera en vez de solo dejar de mirarlo. A diferencia de
 * categoría, no hay un default de eventos ocultos -- ningún evento se
 * descarta hasta que el usuario lo elige explícitamente.
 */
export function ocultarEventos(transacciones: Transaccion[], eventosOcultos: Set<string>): Transaccion[] {
  if (eventosOcultos.size === 0) return transacciones;
  return transacciones.filter((t) => {
    const evento = eventoDe(t);
    return evento === null || !eventosOcultos.has(evento);
  });
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
  excluir?: keyof Filtros | (keyof Filtros)[]
): Transaccion[] {
  // Una gráfica puede excluir más de una dimensión a la vez.
  const excluidas = new Set(excluir === undefined ? [] : Array.isArray(excluir) ? excluir : [excluir]);
  const aplica = (campo: keyof Filtros) => Boolean(filtros[campo]) && !excluidas.has(campo);
  return transacciones.filter((t) => {
    if (aplica("categoria") && categoriaDe(t) !== filtros.categoria) {
      return false;
    }
    if (aplica("comercio") && t.comercio !== filtros.comercio) {
      return false;
    }
    if (aplica("cuenta") && cuentaDe(t) !== filtros.cuenta) {
      return false;
    }
    if (aplica("tarjeta") && t.tarjeta !== filtros.tarjeta) {
      return false;
    }
    if (aplica("evento") && eventoDe(t) !== filtros.evento) {
      return false;
    }
    return true;
  });
}

export interface PuntoIngresoGasto {
  /** "2026-06" en la vista por meses, "2026" en la vista por años. */
  periodo: string;
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
      porMes.set(mes, { periodo: mes, ingresos: 0, gastos: 0 });
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
        porMes.set(clave, { periodo: clave, ingresos: 0, gastos: 0 });
      }
      mes += 1;
      if (mes > 11) {
        mes = 0;
        anio += 1;
      }
    }
  }

  return Array.from(porMes.values()).sort((a, b) => a.periodo.localeCompare(b.periodo));
}

/** Igual que `agruparIngresosGastosPorMes`, por año calendario; también
 * rellena con $0 los años sin movimientos entre el primero y el último. */
export function agruparIngresosGastosPorAnio(
  transacciones: Transaccion[]
): PuntoIngresoGasto[] {
  const porAnio = new Map<string, PuntoIngresoGasto>();
  for (const t of transacciones) {
    const anio = t.fecha.slice(0, 4);
    const punto = porAnio.get(anio) ?? { periodo: anio, ingresos: 0, gastos: 0 };
    if (t.tipo === "abono") punto.ingresos += t.monto;
    else punto.gastos += t.monto;
    porAnio.set(anio, punto);
  }
  const anios = Array.from(porAnio.keys()).map(Number);
  if (anios.length > 0) {
    for (let a = Math.min(...anios); a <= Math.max(...anios); a++) {
      if (!porAnio.has(String(a))) porAnio.set(String(a), { periodo: String(a), ingresos: 0, gastos: 0 });
    }
  }
  return Array.from(porAnio.values()).sort((a, b) => a.periodo.localeCompare(b.periodo));
}

export interface PuntoDimension {
  /** Categoría, comercio o evento. */
  nombre: string;
  ingresos: number;
  gastos: number;
}

/**
 * Suma ingresos y gastos por la dimensión que devuelva `claveDe` (categoría,
 * comercio, evento...). Una dimensión puede tener ambos lados a la vez (p. ej.
 * "Transferencia recibida" o "Pago TDC Beyond" solo del lado de ingresos), así
 * que se ordena por la magnitud combinada (ingresos + gastos) para que el
 * top-N de las gráficas no deje fuera una que es mayormente de ingresos.
 *
 * `claveDe` devuelve null para "no participa": comercio y evento son
 * opcionales por diseño (solo los asignan las reglas que los definen, o el
 * usuario a mano), así que una transacción sin ellos no infla un bucket
 * "Sin comercio"/"Sin evento" poco informativo. Categoría sí tiene fallback
 * (`categoriaDe` → "Sin categoría").
 */
export function agruparPor(
  transacciones: Transaccion[],
  claveDe: (t: Transaccion) => string | null
): PuntoDimension[] {
  const porClave = new Map<string, PuntoDimension>();
  for (const t of transacciones) {
    const nombre = claveDe(t);
    if (!nombre) continue;
    let punto = porClave.get(nombre);
    if (!punto) {
      punto = { nombre, ingresos: 0, gastos: 0 };
      porClave.set(nombre, punto);
    }
    if (t.tipo === "abono") punto.ingresos += t.monto;
    else punto.gastos += t.monto;
  }
  return Array.from(porClave.values()).sort(
    (a, b) => b.ingresos + b.gastos - (a.ingresos + a.gastos)
  );
}

export const comercioDe = (t: Transaccion): string | null => t.comercio;


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

/** Id de la fila de `categorias` o `eventos` con ese nombre, creándola si no
 * existe -- `categoria_id`/`evento_id` son FK, no texto libre, así que
 * escribir un nombre nuevo desde el frontend necesita resolver (o crear) su
 * fila primero (mismo find-or-create que sync/sincronizador.py). Un upsert
 * sobre la llave única (user_id, nombre) lo hace en UN viaje y sin la
 * carrera de "buscar y luego insertar" (dos pestañas creando el mismo
 * nombre); `user_id` lo pone el default `auth.uid()` y la RLS lo acota. */
async function buscarOCrearId(tabla: "categorias" | "eventos", nombre: string): Promise<string> {
  const { data, error } = await supabase
    .from(tabla)
    .upsert({ nombre }, { onConflict: "user_id,nombre" })
    .select("id")
    .single();
  if (error) throw comoError(error);
  return data.id as string;
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

  const [categoriaId, eventoId] = await Promise.all([
    cambios.categoria ? buscarOCrearId("categorias", cambios.categoria) : undefined,
    cambios.evento ? buscarOCrearId("eventos", cambios.evento) : undefined,
  ]);
  const payload: Record<string, unknown> = {};
  if (categoriaId) payload.categoria_id = categoriaId;
  if (cambios.comercio) payload.comercio = cambios.comercio;
  if (eventoId) payload.evento_id = eventoId;
  if (Object.keys(payload).length === 0) return;

  await porLotes(ids, (lote) => supabase.from("transacciones").update(payload).in("id", lote));
}

/**
 * Vacía `evento_id` (a `null`) para los `id` dados -- el único caso donde sí
 * hace falta "vaciar" en vez de reasignar (ver la nota de
 * `actualizarCategoriaComercioYEvento`): un evento mal asignado por error no
 * se puede corregir escribiendo otro nombre si en realidad esa transacción
 * no pertenece a ningún evento. Solo evento, no categoría/comercio -- esos
 * siempre tienen un valor real que corregir (una categoría equivocada se
 * arregla asignando la correcta, nunca "ninguna").
 */
export async function quitarEventoDeTransacciones(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await porLotes(ids, (lote) =>
    supabase.from("transacciones").update({ evento_id: null }).in("id", lote)
  );
}

/**
 * Asigna (o, con `null`, quita) un evento a gastos del correo (`gastos_correo`).
 * Sirve para categorizar el gasto el mismo día que llega el aviso: cuando el estado
 * de cuenta llega y su cargo se empareja con este aviso, el evento se puede heredar
 * (ver `eventosHeredables`). Mismo find-or-create del catálogo `eventos` que usan las
 * transacciones, así que es el MISMO evento. RLS ya limita el update a filas propias.
 */
export async function asignarEventoAGastosCorreo(
  ids: string[],
  evento: string | null
): Promise<string | null> {
  const eventoId = evento ? await buscarOCrearId("eventos", evento) : null;
  if (ids.length === 0) return eventoId;
  await porLotes(ids, (lote) =>
    supabase.from("gastos_correo").update({ evento_id: eventoId }).in("id", lote)
  );
  return eventoId;
}

/** `.in("id", ids)` viaja en la URL de la petición (?id=in.(...)): con
 * cientos de ids seleccionados ("Seleccionar todas las coincidencias" sobre
 * años de historial) la URL rebasaba el límite del servidor y la edición
 * completa fallaba. ~150 UUIDs por petición dejan la URL en ~6 KB. */
const TAMANO_LOTE_IDS = 150;

/** Lotes que viajan a la vez: en paralelo para no sumar un round-trip por
 * lote, pero acotado para no abrir decenas de conexiones de golpe. */
const LOTES_EN_PARALELO = 4;

function enLotes<T>(elementos: T[], tamano = TAMANO_LOTE_IDS): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < elementos.length; i += tamano) lotes.push(elementos.slice(i, i + tamano));
  return lotes;
}

/** Corre `peticion` sobre cada lote de `ids`, `LOTES_EN_PARALELO` a la vez;
 * el primer error se lanza. */
async function porLotes<T>(
  ids: string[],
  peticion: (lote: string[]) => PromiseLike<{ error: T | null }>
): Promise<void> {
  const lotes = enLotes(ids);
  for (let i = 0; i < lotes.length; i += LOTES_EN_PARALELO) {
    const resultados = await Promise.all(lotes.slice(i, i + LOTES_EN_PARALELO).map(peticion));
    const conError = resultados.find((r) => r.error);
    if (conError) throw comoError(conError.error);
  }
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
  await porLotes(documentoIds, (lote) =>
    supabase.from("documentos").update({ cuenta_id: cuentaId }).in("id", lote)
  );
}

