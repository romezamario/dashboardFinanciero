// Cloudflare Pages Function: GET /api/viajes
//
// Los viajes viven en otro proyecto (romezamario/GestionViajes, la "Bitácora de
// viajes", Pages `gestion-viajes`), que los guarda en Workers KV (namespace
// `viajes`, claves `trip:<id>`). El espacio Viajes de este dashboard solo los
// LEE para mostrar el resumen; se editan en la bitácora.
//
// Dos caminos, en este orden:
// 1. El binding KV `TRIPS` en este proyecto de Pages (lo agrega el workflow de
//    GestionViajes, paso "Compartir el KV con el dashboard personal"): lee el
//    KV directo, sin pasar por el otro sitio ni por su Cloudflare Access.
// 2. Sin binding, pide `<VIAJES_URL>/api/trips` (por defecto la liga de la
//    bitácora). Si ese sitio está detrás de Cloudflare Access, hace falta un
//    service token en VIAJES_ACCESS_CLIENT_ID / VIAJES_ACCESS_CLIENT_SECRET.
//
// /api pasa por _middleware.ts: solo el dueño (los invitados no ven Viajes).

export const VIAJES_URL_POR_DEFECTO = "https://gestion-viajes-7wo.pages.dev";

interface ListaKV {
  keys: { name: string }[];
  list_complete: boolean;
  cursor?: string;
}

interface KV {
  list(opciones: { prefix: string; cursor?: string }): Promise<ListaKV>;
  get(clave: string, tipo: "json"): Promise<unknown>;
}

interface Entorno {
  TRIPS?: KV;
  VIAJES_URL?: string;
  VIAJES_ACCESS_CLIENT_ID?: string;
  VIAJES_ACCESS_CLIENT_SECRET?: string;
}

const respuesta = (datos: unknown, status = 200) =>
  Response.json(datos, { status, headers: { "cache-control": "no-store" } });

async function leerKV(kv: KV): Promise<Record<string, unknown>> {
  const viajes: Record<string, unknown> = {};
  let cursor: string | undefined;
  do {
    const pagina = await kv.list({ prefix: "trip:", cursor });
    await Promise.all(
      pagina.keys.map(async (k) => {
        const v = await kv.get(k.name, "json");
        if (v) viajes[k.name.slice(5)] = v;
      }),
    );
    cursor = pagina.list_complete ? undefined : pagina.cursor;
  } while (cursor);
  return viajes;
}

export async function onRequestGet({ env }: { request: Request; env?: Entorno }): Promise<Response> {
  const base = (env?.VIAJES_URL || VIAJES_URL_POR_DEFECTO).replace(/\/+$/, "");
  try {
    if (env?.TRIPS) {
      return respuesta({ viajes: await leerKV(env.TRIPS), fuente: "kv", bitacora: base });
    }
    const encabezados: Record<string, string> = { accept: "application/json" };
    if (env?.VIAJES_ACCESS_CLIENT_ID && env.VIAJES_ACCESS_CLIENT_SECRET) {
      encabezados["CF-Access-Client-Id"] = env.VIAJES_ACCESS_CLIENT_ID;
      encabezados["CF-Access-Client-Secret"] = env.VIAJES_ACCESS_CLIENT_SECRET;
    }
    const r = await fetch(`${base}/api/trips`, { headers: encabezados, redirect: "manual" });
    const tipo = r.headers.get("content-type") ?? "";
    if (!r.ok || !tipo.includes("application/json")) {
      const motivo =
        r.status >= 300 && r.status < 400
          ? "La bitácora pide el login de Cloudflare Access: falta el service token (VIAJES_ACCESS_CLIENT_ID/SECRET) o compartir el KV con este proyecto."
          : `La bitácora respondió ${r.status}.`;
      return respuesta({ error: motivo, bitacora: base }, 502);
    }
    const datos = (await r.json()) as { trips?: Record<string, unknown> };
    return respuesta({ viajes: datos.trips ?? {}, fuente: "api", bitacora: base });
  } catch (e) {
    return respuesta({ error: `No se pudieron leer los viajes: ${(e as Error).message}`, bitacora: base }, 502);
  }
}
