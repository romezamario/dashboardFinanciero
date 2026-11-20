// Revisa Gmail en la nube y guarda los gastos en `gastos_correo`: lo mismo que
// la pestaña "Gastos recientes (Gmail)" de la app de escritorio
// (`sync/gmail_gastos.revisar_gmail(dias, subir=True)`), sin que la laptop esté
// prendida. La lectura del aviso vive en avisos.ts (puro, probado).
//
// Quién la llama:
// * pg_cron cada 15 min (migración 20261120030000_gmail_en_la_nube.sql), con
//   el encabezado x-cron-secreto: revisa a todos los que conectaron Gmail.
// * El botón "Revisar ahora" del dashboard, con la sesión del usuario: solo su
//   propio Gmail. `comparar: true` no guarda nada: vuelve a leer los avisos de
//   la ventana y dice si salen iguales a lo ya guardado (para verificar).
//
// verify_jwt = false (pg_cron no tiene sesión): la autorización se hace aquí.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  aFila,
  CONSULTA_GMAIL,
  ciudadesValidas,
  clasificar,
  esDebito,
  htmlDelMensaje,
  parsearAviso,
  reglasValidas,
  type FilaGasto,
  type Regla,
} from "./avisos.ts";

const DIAS_POR_DEFECTO = 3;
const DIAS_MAXIMO = 60;
const MAXIMO_POR_LLAMADA = 500;
const DESCARGAS_EN_PARALELO = 4;
// Gmail cobra 5 unidades por mensaje y corta a 250 unidades/s por usuario; sin
// pausa la función bajaba >50 mensajes/s y una ventana de 14-30 días chocaba
// con el límite (2026-11-20). Cada tanda de 4 tarda al menos esto: ~16/s.
const MS_MINIMOS_POR_TANDA = 250;
const REINTENTOS_GMAIL = 6;
const DIAS_BITACORA = 30;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

class ErrorGmail extends Error {
  constructor(public tipo: "permiso_invalido" | "limite" | "error", mensaje: string) {
    super(mensaje);
  }
}

const MENSAJE_PERMISO =
  "El permiso de Gmail venció o fue revocado. Usa \"Reconectar Gmail\" aquí mismo (o \"Reautorizar Gmail\" en la app de escritorio).";
const MENSAJE_LIMITE =
  "Gmail limitó las consultas por minuto; lo leído ya quedó guardado y la siguiente revisión sigue donde se quedó.";

interface Conexion {
  user_id: string;
  correo: string | null;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  invalida: boolean;
}

async function tokenDeAcceso(c: Conexion): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.client_id,
      client_secret: c.client_secret,
      refresh_token: c.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok || !datos.access_token) {
    if (r.status === 400 || r.status === 401) throw new ErrorGmail("permiso_invalido", MENSAJE_PERMISO);
    throw new ErrorGmail("error", `Google respondió ${r.status} al renovar el permiso.`);
  }
  return datos.access_token as string;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a la API de Gmail con reintentos ante 429/403 de cuota y 5xx. */
async function gmail<T>(token: string, ruta: string): Promise<T> {
  for (let intento = 0; ; intento++) {
    const r = await fetch(`${GMAIL}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) return (await r.json()) as T;
    const texto = await r.text();
    const cuota = r.status === 429 || (r.status === 403 && /ratelimit|quota/i.test(texto));
    if ((cuota || r.status >= 500) && intento < REINTENTOS_GMAIL) {
      // Retry-After si Gmail lo manda; si no, 1, 2, 4, 8, 16, 30 s.
      const pedido = Number(r.headers.get("retry-after"));
      const ms = pedido > 0 ? pedido * 1000 : Math.min(2 ** intento * 1000, 30_000);
      await esperar(ms + Math.random() * 500);
      continue;
    }
    if (r.status === 401) throw new ErrorGmail("permiso_invalido", MENSAJE_PERMISO);
    if (cuota) throw new ErrorGmail("limite", MENSAJE_LIMITE);
    throw new ErrorGmail("error", `Gmail respondió ${r.status}: ${texto.slice(0, 200)}`);
  }
}

async function listarIds(token: string, dias: number): Promise<string[]> {
  const ids: string[] = [];
  let pagina: string | undefined;
  do {
    const q = new URLSearchParams({ q: CONSULTA_GMAIL(dias), maxResults: "500" });
    if (pagina) q.set("pageToken", pagina);
    const r = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `/messages?${q}`);
    ids.push(...(r.messages ?? []).map((m) => m.id));
    pagina = r.nextPageToken;
  } while (pagina);
  return ids;
}

type Leido = { id: string; tipo: "aviso"; aviso: NonNullable<ReturnType<typeof parsearAviso>> } | { id: string; tipo: "debito" | "ilegible" };

/** Descarga y lee los ids; si Gmail falla a media lectura devuelve lo leído y el error. */
async function leer(token: string, ids: string[]): Promise<{ leidos: Leido[]; error: ErrorGmail | null }> {
  const leidos: Leido[] = [];
  for (let i = 0; i < ids.length; i += DESCARGAS_EN_PARALELO) {
    const tanda = ids.slice(i, i + DESCARGAS_EN_PARALELO);
    const inicio = Date.now();
    try {
      const mensajes = await Promise.all(tanda.map((id) => gmail<{ payload?: never }>(token, `/messages/${id}?format=full`)));
      mensajes.forEach((m, j) => {
        const id = tanda[j];
        const html = htmlDelMensaje(m);
        const aviso = html ? parsearAviso(html, id) : null;
        if (aviso) leidos.push({ id, tipo: "aviso", aviso });
        else leidos.push({ id, tipo: html && esDebito(html) ? "debito" : "ilegible" });
      });
      const resta = MS_MINIMOS_POR_TANDA - (Date.now() - inicio);
      if (resta > 0 && i + DESCARGAS_EN_PARALELO < ids.length) await esperar(resta);
    } catch (e) {
      return { leidos, error: e instanceof ErrorGmail ? e : new ErrorGmail("error", (e as Error).message) };
    }
  }
  return { leidos, error: null };
}

async function huella(valor: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(valor));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function preferencia(admin: SupabaseClient, userId: string, clave: string): Promise<unknown> {
  const { data, error } = await admin.from("preferencias").select("valor").eq("user_id", userId).eq("clave", clave).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.valor ?? null;
}

const COLUMNAS = "mensaje_id, fecha, hora, tarjeta, comercio, categoria, establecimiento, ciudad_cod, ciudad, monto, moneda";
type FilaGuardada = Omit<FilaGasto, "monto"> & { monto: number | string };

async function filasGuardadas(admin: SupabaseClient, userId: string, ids?: string[]): Promise<FilaGuardada[]> {
  const todas: FilaGuardada[] = [];
  if (ids) {
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await admin.from("gastos_correo").select(COLUMNAS).eq("user_id", userId).in("mensaje_id", ids.slice(i, i + 100));
      if (error) throw new Error(error.message);
      todas.push(...((data ?? []) as FilaGuardada[]));
    }
    return todas;
  }
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await admin
      .from("gastos_correo")
      .select(COLUMNAS)
      .eq("user_id", userId)
      .order("mensaje_id")
      .range(desde, desde + 999);
    if (error) throw new Error(error.message);
    todas.push(...((data ?? []) as FilaGuardada[]));
    if (!data || data.length < 1000) return todas;
  }
}

async function guardarFilas(admin: SupabaseClient, userId: string, filas: FilaGasto[]) {
  const unicas = [...new Map(filas.map((f) => [f.mensaje_id, { ...f, user_id: userId }])).values()];
  for (let i = 0; i < unicas.length; i += MAXIMO_POR_LLAMADA) {
    const { error } = await admin.from("gastos_correo").upsert(unicas.slice(i, i + MAXIMO_POR_LLAMADA), { onConflict: "user_id,mensaje_id" });
    if (error) throw new Error(error.message);
  }
}

const monto2 = (m: number | string) => Number(m).toFixed(2);

/** Vuelve a clasificar TODO lo guardado con las reglas actuales (como
 * `recategorizar_guardados` de escritorio); solo reescribe lo que cambió. */
async function recategorizar(admin: SupabaseClient, userId: string, reglas: Regla[], ciudades: Record<string, string>) {
  const cambiadas: FilaGasto[] = [];
  for (const f of await filasGuardadas(admin, userId)) {
    if (!f.establecimiento) continue;
    const nuevo = clasificar(f.establecimiento, reglas, ciudades);
    if (nuevo.categoria !== f.categoria || nuevo.comercio !== f.comercio || nuevo.ciudad_cod !== f.ciudad_cod || nuevo.ciudad !== f.ciudad) {
      cambiadas.push({ ...f, ...nuevo, monto: monto2(f.monto) });
    }
  }
  await guardarFilas(admin, userId, cambiadas);
  return cambiadas.length;
}

async function revisar(admin: SupabaseClient, c: Conexion, origen: "programada" | "manual", dias: number) {
  const inicio = Date.now();
  const registro = {
    user_id: c.user_id,
    origen,
    resultado: "ok" as string,
    mensaje: null as string | null,
    avisos: 0,
    nuevos: 0,
    recategorizados: 0,
    debitos: 0,
    ilegibles: [] as string[],
    sin_categoria: [] as string[],
    codigos_sin_confirmar: [] as string[],
    reglas_huella: null as string | null,
  };
  try {
    const reglas = reglasValidas(await preferencia(admin, c.user_id, "reglas_categorizacion"));
    const ciudades = ciudadesValidas(await preferencia(admin, c.user_id, "ciudades_correo"));
    if (reglas.length) {
      registro.reglas_huella = await huella({ reglas, ciudades });
      const { data: previa } = await admin
        .from("gmail_revisiones")
        .select("reglas_huella")
        .eq("user_id", c.user_id)
        .not("reglas_huella", "is", null)
        .order("empezo_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (previa?.reglas_huella !== registro.reglas_huella) {
        registro.recategorizados = await recategorizar(admin, c.user_id, reglas, ciudades);
      }
    }

    const token = await tokenDeAcceso(c);
    if (c.invalida) await admin.rpc("marcar_gmail_invalido", { p_user_id: c.user_id, p_invalida: false });
    const ids = await listarIds(token, dias);
    const conocidos = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const tanda = ids.slice(i, i + 100);
      const [g, o] = await Promise.all([
        admin.from("gastos_correo").select("mensaje_id").eq("user_id", c.user_id).in("mensaje_id", tanda),
        admin.from("gmail_omitidos").select("mensaje_id").eq("user_id", c.user_id).in("mensaje_id", tanda),
      ]);
      if (g.error || o.error) throw new Error((g.error ?? o.error)!.message);
      for (const f of [...(g.data ?? []), ...(o.data ?? [])]) conocidos.add(f.mensaje_id);
    }
    const { leidos, error } = await leer(token, ids.filter((id) => !conocidos.has(id)));
    const filas = leidos.flatMap((l) => (l.tipo === "aviso" ? [aFila(l.aviso, reglas, ciudades)] : []));
    await guardarFilas(admin, c.user_id, filas);
    const debitos = leidos.filter((l) => l.tipo === "debito").map((l) => ({ user_id: c.user_id, mensaje_id: l.id, tipo: "debito" }));
    if (debitos.length) {
      const { error: e } = await admin.from("gmail_omitidos").upsert(debitos, { onConflict: "user_id,mensaje_id" });
      if (e) throw new Error(e.message);
    }
    registro.nuevos = filas.length;
    registro.ilegibles = leidos.filter((l) => l.tipo === "ilegible").map((l) => l.id);
    if (!reglas.length) {
      registro.resultado = "sin_reglas";
      registro.mensaje =
        "No hay reglas de categorización en la nube: los gastos quedan \"Sin categoría\" hasta que la app de escritorio las suba (lo hace al revisar Gmail o al sincronizar).";
    }
    if (error) throw error;

    // Resumen de la ventana (lo nuevo y lo ya guardado), como el de escritorio.
    const enVentana = await filasGuardadas(admin, c.user_id, ids);
    const { count } = await admin
      .from("gmail_omitidos")
      .select("mensaje_id", { count: "exact", head: true })
      .eq("user_id", c.user_id)
      .in("mensaje_id", ids.length ? ids : ["-"]);
    registro.avisos = enVentana.length;
    registro.debitos = count ?? 0;
    registro.sin_categoria = [...new Set(enVentana.filter((f) => f.categoria === "Sin categoría").map((f) => f.establecimiento))].sort();
    registro.codigos_sin_confirmar = [...new Set(enVentana.filter((f) => !f.ciudad && f.ciudad_cod).map((f) => f.ciudad_cod))].sort();
  } catch (e) {
    registro.resultado = e instanceof ErrorGmail ? e.tipo : "error";
    registro.mensaje = (e as Error).message;
    if (registro.resultado === "permiso_invalido") await admin.rpc("marcar_gmail_invalido", { p_user_id: c.user_id, p_invalida: true });
    console.error("revisar-gmail", c.user_id, registro.resultado, registro.mensaje);
  }
  const duracion_ms = Date.now() - inicio;
  await admin.from("gmail_revisiones").insert({ ...registro, duracion_ms });
  await admin
    .from("gmail_revisiones")
    .delete()
    .eq("user_id", c.user_id)
    .lt("empezo_en", new Date(Date.now() - DIAS_BITACORA * 86_400_000).toISOString());
  return { ...registro, duracion_ms };
}

/** Verificación: vuelve a leer TODOS los avisos de la ventana y los compara
 * con lo guardado (campo por campo). No guarda nada. */
async function comparar(admin: SupabaseClient, c: Conexion, dias: number) {
  const reglas = reglasValidas(await preferencia(admin, c.user_id, "reglas_categorizacion"));
  const ciudades = ciudadesValidas(await preferencia(admin, c.user_id, "ciudades_correo"));
  const token = await tokenDeAcceso(c);
  const ids = await listarIds(token, dias);
  const { leidos, error } = await leer(token, ids);
  if (error) throw error;
  const guardadas = new Map((await filasGuardadas(admin, c.user_id, ids)).map((f) => [f.mensaje_id, f]));
  let iguales = 0;
  const distintos: { mensaje_id: string; campos: string[] }[] = [];
  const soloEnGmail: string[] = [];
  for (const l of leidos) {
    if (l.tipo !== "aviso") continue;
    const nueva = aFila(l.aviso, reglas, ciudades);
    const vieja = guardadas.get(l.id);
    if (!vieja) {
      soloEnGmail.push(l.id);
      continue;
    }
    const campos = (Object.keys(nueva) as (keyof FilaGasto)[]).filter((k) =>
      k === "monto" ? monto2(vieja.monto) !== nueva.monto : (vieja[k] ?? null) !== (nueva[k] ?? null)
    );
    if (campos.length) distintos.push({ mensaje_id: l.id, campos });
    else iguales++;
  }
  return {
    correos: ids.length,
    avisos: leidos.filter((l) => l.tipo === "aviso").length,
    debitos: leidos.filter((l) => l.tipo === "debito").length,
    ilegibles: leidos.filter((l) => l.tipo === "ilegible").length,
    iguales,
    distintos,
    soloEnGmail,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder(405, { error: "Método no permitido" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cuerpo = await req.json().catch(() => ({}));
  const dias = Math.min(DIAS_MAXIMO, Math.max(1, Math.round(Number(cuerpo?.dias) || DIAS_POR_DEFECTO)));

  const { data: todas, error } = await admin.rpc("conexiones_gmail");
  if (error) return responder(500, { error: error.message });
  const conexiones = (todas ?? []) as Conexion[];

  const secreto = req.headers.get("x-cron-secreto");
  if (secreto) {
    const { data: valido } = await admin.rpc("validar_cron_gmail", { p_secreto: secreto });
    if (!valido) return responder(401, { error: "No autorizado" });
    const resultados = [];
    // Una conexión marcada inválida no se reintenta cada 15 min: espera a que
    // se reconecte (dashboard o escritorio) o a un "Revisar ahora".
    for (const c of conexiones.filter((c) => !c.invalida)) resultados.push(await revisar(admin, c, "programada", DIAS_POR_DEFECTO));
    return responder(200, { resultados: resultados.map(({ user_id: _u, ...r }) => r) });
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: sesion } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!sesion?.user) return responder(401, { error: "Inicia sesión." });
  const conexion = conexiones.find((c) => c.user_id === sesion.user!.id);
  if (!conexion) return responder(404, { error: "Tu Gmail todavía no está conectado al dashboard." });
  if (cuerpo?.comparar) {
    try {
      return responder(200, await comparar(admin, conexion, dias));
    } catch (e) {
      return responder(502, { error: (e as Error).message });
    }
  }
  const { user_id: _u, ...resultado } = await revisar(admin, conexion, "manual", dias);
  return responder(200, resultado);
});
