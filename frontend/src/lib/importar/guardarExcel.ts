// Guarda los movimientos de una plantilla de Excel con la sesión del cliente
// (RLS limita todo a sus filas). Mismo esquema que los PDFs (guardar.ts), con
// dos diferencias:
// - El documento no es el archivo sino la cuenta: todas las plantillas que se
//   suben a una cuenta caen en un mismo documento ("excel:<cuenta>"), y la
//   llave de cada movimiento es su contenido (fecha | descripción | monto |
//   tipo). Así, volver a subir el archivo con filas nuevas solo agrega las
//   nuevas, aunque el archivo haya cambiado.
// - La categoría y el comercio escritos en el Excel se aplican siempre (son del
//   cliente); si vienen vacíos, las reglas base llenan solo los movimientos que
//   aún no tienen ninguno de los dos.

import { supabase } from "../supabase";
import type { MovimientoExcel } from "./excel";
import { comoError, idBanco } from "./guardar";
import { lineaLibre, type MovimientoManual } from "./manual";
import { periodo } from "./procesar";
import { categorizar } from "./reglasBase";

/** Bancos del catálogo para las cuentas que se crean desde Excel. "TDC" en el
 * nombre es lo que marca una tarjeta de crédito en el tablero
 * (esTarjetaCredito). */
export const BANCO_EXCEL = "Archivo Excel";
export const BANCO_EXCEL_TDC = "Archivo Excel TDC";

const LOTE = 500;
const LOTE_IDS = 150;

export interface CuentaExistente {
  id: string;
  alias: string;
  banco: string;
  ultimos4: string | null;
}

export async function obtenerCuentas(): Promise<CuentaExistente[]> {
  const { data, error } = await supabase.from("cuentas").select("id, alias, ultimos_4_digitos, bancos(nombre)").order("alias");
  if (error) throw comoError(error);
  return (data ?? []).map((c) => {
    const banco = c.bancos as unknown as { nombre: string } | { nombre: string }[] | null;
    return {
      id: c.id as string,
      alias: c.alias as string,
      ultimos4: (c.ultimos_4_digitos as string | null) ?? null,
      banco: (Array.isArray(banco) ? banco[0]?.nombre : banco?.nombre) ?? "",
    };
  });
}

export type DestinoExcel =
  | { tipo: "existente"; cuentaId: string }
  | { tipo: "nueva"; alias: string; ultimos4: string | null; tarjetaCredito: boolean };

async function idCuentaNueva(destino: Extract<DestinoExcel, { tipo: "nueva" }>): Promise<string> {
  const bancoId = await idBanco(destino.tarjetaCredito ? BANCO_EXCEL_TDC : BANCO_EXCEL);
  const alias = destino.alias.trim();
  let consulta = supabase.from("cuentas").select("id, alias").eq("banco_id", bancoId);
  // Sin últimos 4 (efectivo, una cuenta que no los tiene a la mano) la cuenta
  // se reconoce por su nombre.
  consulta = destino.ultimos4 ? consulta.eq("ultimos_4_digitos", destino.ultimos4) : consulta.is("ultimos_4_digitos", null).eq("alias", alias);
  const { data, error } = await consulta.limit(1).maybeSingle();
  if (error) throw comoError(error);
  if (data) {
    if (data.alias !== alias) {
      const cambio = await supabase.from("cuentas").update({ alias }).eq("id", data.id);
      if (cambio.error) throw comoError(cambio.error);
    }
    return data.id;
  }
  const creada = await supabase
    .from("cuentas")
    .insert({ banco_id: bancoId, alias, ultimos_4_digitos: destino.ultimos4 })
    .select("id")
    .single();
  if (creada.error) throw comoError(creada.error);
  return creada.data.id;
}

async function idDocumento(cuentaId: string, rango: { inicio: string; fin: string } | null): Promise<string> {
  const hash = `excel:${cuentaId}`;
  const { data, error } = await supabase
    .from("documentos")
    .select("id, periodo_inicio, periodo_fin")
    .eq("hash", hash)
    .maybeSingle();
  if (error) throw comoError(error);
  if (data) {
    // El periodo crece con cada archivo que se sube.
    if (rango) {
      const inicio = data.periodo_inicio && data.periodo_inicio < rango.inicio ? data.periodo_inicio : rango.inicio;
      const fin = data.periodo_fin && data.periodo_fin > rango.fin ? data.periodo_fin : rango.fin;
      if (inicio !== data.periodo_inicio || fin !== data.periodo_fin) {
        const cambio = await supabase.from("documentos").update({ periodo_inicio: inicio, periodo_fin: fin }).eq("id", data.id);
        if (cambio.error) throw comoError(cambio.error);
      }
    }
    return data.id;
  }
  const creado = await supabase
    .from("documentos")
    .insert({
      cuenta_id: cuentaId,
      hash,
      periodo_inicio: rango?.inicio ?? null,
      periodo_fin: rango?.fin ?? null,
      ruta_local: null,
    })
    .select("id")
    .single();
  if (creado.error) throw comoError(creado.error);
  return creado.data.id;
}

interface FilaGuardada {
  id: string;
  linea_cruda: string;
  descripcion: string;
  categoria_id: string | null;
  comercio: string | null;
}

/** Qué cambiar en cada fila ya guardada: lo escrito en el Excel gana; si no
 * escribió nada, las reglas base, solo en filas sin categoría ni comercio.
 * Exportada para probarla sin red. */
export function cambiosDeCategoria(
  guardadas: readonly FilaGuardada[],
  porLinea: ReadonlyMap<string, Pick<MovimientoExcel, "categoria" | "comercio">>
): Map<string, { categoria?: string; comercio?: string; ids: string[] }> {
  const grupos = new Map<string, { categoria?: string; comercio?: string; ids: string[] }>();
  for (const fila of guardadas) {
    const escrito = porLinea.get(fila.linea_cruda);
    let categoria: string | undefined;
    let comercio: string | undefined;
    if (escrito?.categoria || escrito?.comercio) {
      categoria = escrito.categoria ?? undefined;
      comercio = escrito.comercio ?? undefined;
      if (!categoria && fila.categoria_id === null) categoria = categorizar(fila.descripcion)?.categoria;
    } else if (fila.categoria_id === null && fila.comercio === null) {
      const regla = categorizar(fila.descripcion);
      if (!regla) continue;
      categoria = regla.categoria;
      comercio = regla.comercio ?? undefined;
    } else continue;
    const clave = `${categoria ?? ""}\u0000${comercio ?? ""}`;
    const grupo = grupos.get(clave) ?? { categoria, comercio, ids: [] };
    grupo.ids.push(fila.id);
    grupos.set(clave, grupo);
  }
  return grupos;
}

async function aplicarCategorias(grupos: Map<string, { categoria?: string; comercio?: string; ids: string[] }>) {
  if (grupos.size === 0) return;
  const nombres = [...new Set([...grupos.values()].flatMap((g) => (g.categoria ? [g.categoria] : [])))];
  const idDe = new Map<string, string>();
  if (nombres.length > 0) {
    const { data, error } = await supabase
      .from("categorias")
      .upsert(
        nombres.map((nombre) => ({ nombre })),
        { onConflict: "user_id,nombre" }
      )
      .select("id, nombre");
    if (error) throw comoError(error);
    for (const c of data ?? []) idDe.set(c.nombre as string, c.id as string);
  }
  for (const { categoria, comercio, ids } of grupos.values()) {
    const cambio: { categoria_id?: string; comercio?: string } = {};
    if (categoria && idDe.has(categoria)) cambio.categoria_id = idDe.get(categoria);
    if (comercio) cambio.comercio = comercio;
    if (Object.keys(cambio).length === 0) continue;
    // Los ids van en la URL: en lotes para no pasar su límite.
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const r = await supabase.from("transacciones").update(cambio).in("id", ids.slice(i, i + LOTE_IDS));
      if (r.error) throw comoError(r.error);
    }
  }
}

const idCuenta = (destino: DestinoExcel) =>
  destino.tipo === "existente" ? Promise.resolve(destino.cuentaId) : idCuentaNueva(destino);

/** Guarda y devuelve cuántos movimientos se guardaron. */
export async function guardarExcel(destino: DestinoExcel, movimientos: readonly MovimientoExcel[]): Promise<number> {
  const cuentaId = await idCuenta(destino);
  const documentoId = await idDocumento(cuentaId, periodo(movimientos));
  const porLinea = new Map(movimientos.map((m) => [m.linea_cruda, m]));
  const filas = movimientos.map((m) => ({
    documento_id: documentoId,
    fecha: m.fecha,
    descripcion: m.descripcion,
    monto: m.monto,
    tipo: m.tipo,
    pagina: m.pagina,
    linea_cruda: m.linea_cruda,
  }));
  const guardadas: FilaGuardada[] = [];
  for (let i = 0; i < filas.length; i += LOTE) {
    const { data, error } = await supabase
      .from("transacciones")
      .upsert(filas.slice(i, i + LOTE), { onConflict: "documento_id,pagina,linea_cruda" })
      .select("id, linea_cruda, descripcion, categoria_id, comercio");
    if (error) throw comoError(error);
    guardadas.push(...((data ?? []) as FilaGuardada[]));
  }
  await aplicarCategorias(cambiosDeCategoria(guardadas, porLinea));
  return filas.length;
}

/** Un movimiento capturado a mano (CapturaManual.tsx). Cae en el mismo
 * documento de la cuenta que las plantillas de Excel; a diferencia de ellas
 * siempre AGREGA: si ya hay uno idéntico (dos cafés iguales el mismo día), el
 * nuevo se guarda como "… (2)". Devuelve su id (para "Deshacer") y el de la
 * cuenta (para que la siguiente captura la ofrezca ya elegida). */
export async function guardarManual(
  destino: DestinoExcel,
  movimiento: MovimientoManual
): Promise<{ id: string; cuentaId: string }> {
  const cuentaId = await idCuenta(destino);
  const documentoId = await idDocumento(cuentaId, { inicio: movimiento.fecha, fin: movimiento.fecha });
  // `like` puede traer de más (un "_" o "%" en la descripción es comodín):
  // lineaLibre compara exacto.
  const { data: parecidas, error } = await supabase
    .from("transacciones")
    .select("linea_cruda")
    .eq("documento_id", documentoId)
    .eq("pagina", movimiento.pagina)
    .like("linea_cruda", `${movimiento.linea_cruda}%`);
  if (error) throw comoError(error);
  const linea = lineaLibre(
    movimiento.linea_cruda,
    (parecidas ?? []).map((f) => f.linea_cruda as string)
  );
  const { data, error: errorAlta } = await supabase
    .from("transacciones")
    .insert({
      documento_id: documentoId,
      fecha: movimiento.fecha,
      descripcion: movimiento.descripcion,
      monto: movimiento.monto,
      tipo: movimiento.tipo,
      pagina: movimiento.pagina,
      linea_cruda: linea,
    })
    .select("id, linea_cruda, descripcion, categoria_id, comercio")
    .single();
  if (errorAlta) throw comoError(errorAlta);
  await aplicarCategorias(cambiosDeCategoria([data as FilaGuardada], new Map([[linea, movimiento]])));
  return { id: data.id as string, cuentaId };
}

/** "Deshacer" de una captura manual: la RLS solo deja borrar filas propias. */
export async function borrarMovimiento(id: string): Promise<void> {
  const { error } = await supabase.from("transacciones").delete().eq("id", id);
  if (error) throw comoError(error);
}
