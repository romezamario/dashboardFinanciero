// Guarda en Supabase lo que se leyó de un PDF en el navegador, con la sesión
// del cliente (RLS limita todo a sus filas). Mismo diseño que
// sync/sincronizador.py: buscar-o-crear banco, cuenta y documento, y upsert de
// los movimientos por (documento_id, pagina, linea_cruda), así que subir el
// mismo PDF dos veces no duplica nada. Solo manda las columnas que salen del
// PDF: la categoría o el evento que el cliente ya asignó se conservan. Los
// movimientos que quedan sin categoría ni comercio reciben los de las reglas
// base (reglasBase.ts).

import { supabase } from "../supabase";
import type { MovimientoImportado } from "./procesar";
import { periodo } from "./procesar";
import { categorizar, type Regla } from "./reglasBase";

const LOTE = 500;
const LOTE_IDS = 150;

export function comoError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error de Supabase");
}

export async function idBanco(nombre: string): Promise<string> {
  const buscar = () => supabase.from("bancos").select("id").eq("nombre", nombre).maybeSingle();
  const existente = await buscar();
  if (existente.error) throw comoError(existente.error);
  if (existente.data) return existente.data.id;
  const creado = await supabase.from("bancos").insert({ nombre }).select("id").single();
  if (!creado.error) return creado.data.id;
  // Otro cliente lo creó al mismo tiempo (nombre es único): ya existe.
  const otraVez = await buscar();
  if (otraVez.error || !otraVez.data) throw comoError(creado.error);
  return otraVez.data.id;
}

async function idCuenta(bancoId: string, alias: string, ultimos4: string): Promise<string> {
  const { data, error } = await supabase
    .from("cuentas")
    .select("id, alias")
    .eq("banco_id", bancoId)
    .eq("ultimos_4_digitos", ultimos4)
    .maybeSingle();
  if (error) throw comoError(error);
  if (data) {
    // El último alias escrito gana, como en el sincronizador.
    if (data.alias !== alias) {
      const cambio = await supabase.from("cuentas").update({ alias }).eq("id", data.id);
      if (cambio.error) throw comoError(cambio.error);
    }
    return data.id;
  }
  const creada = await supabase
    .from("cuentas")
    .insert({ banco_id: bancoId, alias, ultimos_4_digitos: ultimos4 })
    .select("id")
    .single();
  if (creada.error) throw comoError(creada.error);
  return creada.data.id;
}

async function idDocumento(
  cuentaId: string,
  hash: string,
  rango: { inicio: string; fin: string } | null
): Promise<string> {
  const { data, error } = await supabase.from("documentos").select("id, cuenta_id").eq("hash", hash).maybeSingle();
  if (error) throw comoError(error);
  if (data) {
    if (data.cuenta_id !== cuentaId) {
      const cambio = await supabase.from("documentos").update({ cuenta_id: cuentaId }).eq("id", data.id);
      if (cambio.error) throw comoError(cambio.error);
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
      // Sin ruta: en el navegador solo hay un nombre de archivo, que puede
      // traer el nombre del cliente.
      ruta_local: null,
    })
    .select("id")
    .single();
  if (creado.error) throw comoError(creado.error);
  return creado.data.id;
}

export interface DatosParaGuardar {
  banco: string;
  alias: string;
  ultimos4: string;
  hash: string;
  movimientos: readonly MovimientoImportado[];
}

/** Devuelve cuántos movimientos se guardaron. */
export async function guardarImportacion(datos: DatosParaGuardar): Promise<number> {
  const bancoId = await idBanco(datos.banco);
  const cuentaId = await idCuenta(bancoId, datos.alias.trim(), datos.ultimos4);
  const documentoId = await idDocumento(cuentaId, datos.hash, periodo(datos.movimientos));
  const filas = datos.movimientos.map((m) => ({ ...m, documento_id: documentoId }));
  const sinCategoria: { id: string; descripcion: string }[] = [];
  for (let i = 0; i < filas.length; i += LOTE) {
    const { data, error } = await supabase
      .from("transacciones")
      .upsert(filas.slice(i, i + LOTE), { onConflict: "documento_id,pagina,linea_cruda" })
      .select("id, descripcion, categoria_id, comercio");
    if (error) throw comoError(error);
    for (const fila of data ?? []) if (fila.categoria_id === null && fila.comercio === null) sinCategoria.push(fila);
  }
  await categorizarNuevas(sinCategoria);
  return filas.length;
}

/** Pone categoría y comercio de las reglas base a los movimientos que no
 * tienen ninguno de los dos. Así, volver a subir el PDF nunca pisa lo que el
 * cliente ya corrigió a mano. */
async function categorizarNuevas(filas: readonly { id: string; descripcion: string }[]): Promise<void> {
  const grupos = new Map<string, { regla: Regla; ids: string[] }>();
  for (const fila of filas) {
    const regla = categorizar(fila.descripcion);
    if (!regla) continue;
    const clave = `${regla.categoria}\u0000${regla.comercio ?? ""}`;
    const grupo = grupos.get(clave) ?? { regla, ids: [] };
    grupo.ids.push(fila.id);
    grupos.set(clave, grupo);
  }
  if (grupos.size === 0) return;

  const nombres = [...new Set([...grupos.values()].map((g) => g.regla.categoria))];
  const { data, error } = await supabase
    .from("categorias")
    .upsert(
      nombres.map((nombre) => ({ nombre })),
      { onConflict: "user_id,nombre" }
    )
    .select("id, nombre");
  if (error) throw comoError(error);
  const idDe = new Map((data ?? []).map((c) => [c.nombre as string, c.id as string]));

  for (const { regla, ids } of grupos.values()) {
    const categoriaId = idDe.get(regla.categoria);
    if (!categoriaId) continue;
    // Los ids van en la URL: en lotes para no pasar su límite.
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const cambio = await supabase
        .from("transacciones")
        .update({ categoria_id: categoriaId, comercio: regla.comercio })
        .in("id", ids.slice(i, i + LOTE_IDS));
      if (cambio.error) throw comoError(cambio.error);
    }
  }
}

export interface MuestraParaEnviar {
  motivo: "sin-texto" | "banco-desconocido" | "sin-movimientos" | "faltan-movimientos";
  banco_detectado: string | null;
  comentario: string | null;
  paginas: number;
  texto_anonimizado: string;
  /** Cuántos movimientos sí se leyeron (solo "faltan movimientos"). */
  movimientos_leidos?: number | null;
  /** Retroalimentación: la muestra anterior que el cliente estaba probando. */
  muestra_origen_id?: string | null;
}

export async function enviarMuestra(muestra: MuestraParaEnviar): Promise<void> {
  const { error } = await supabase.from("muestras_estados_cuenta").insert(muestra);
  if (error) throw comoError(error);
}
