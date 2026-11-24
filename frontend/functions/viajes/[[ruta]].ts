// Cloudflare Pages Function: /viajes/* → la Bitácora de viajes.
//
// Mario (2026-11-24): "no quiero tener 2 direcciones. Todo queda en Dashboard
// personal". La bitácora sigue siendo su propio proyecto (repo
// romezamario/GestionViajes, Pages `gestion-viajes`); aquí NO se copia su
// código: esta Function reenvía cada petición de /viajes/<ruta> a
// <VIAJES_URL>/<ruta> (página, /api/trips para leer y guardar, /api/maps/…) y
// devuelve la respuesta tal cual. Así se usa completa bajo la dirección del
// dashboard, en la misma pestaña y detrás de su mismo Cloudflare Access. La
// bitácora usa rutas relativas ("api/trips") para que funcione en los dos lados.
//
// Si la bitácora queda detrás de Cloudflare Access, hace falta un service token
// en VIAJES_ACCESS_CLIENT_ID / VIAJES_ACCESS_CLIENT_SECRET (igual que /api/viajes).

// Igual que en functions/api/viajes/index.ts.
const VIAJES_URL_POR_DEFECTO = "https://gestion-viajes-7wo.pages.dev";

interface Entorno {
  VIAJES_URL?: string;
  VIAJES_ACCESS_CLIENT_ID?: string;
  VIAJES_ACCESS_CLIENT_SECRET?: string;
}

const ENCABEZADOS_REENVIADOS = ["accept", "content-type", "if-none-match", "if-modified-since"];
const ENCABEZADOS_DEVUELTOS = ["content-type", "cache-control", "etag", "last-modified"];

export async function onRequest({ request, env }: { request: Request; env?: Entorno }): Promise<Response> {
  const url = new URL(request.url);
  // /viajes → /viajes/ (con la diagonal, "api/trips" relativo cae en /viajes/api/trips).
  if (url.pathname === "/viajes") return Response.redirect(`${url.origin}/viajes/${url.search}`, 301);

  const base = (env?.VIAJES_URL || VIAJES_URL_POR_DEFECTO).replace(/\/+$/, "");
  const destino = `${base}${url.pathname.slice("/viajes".length)}${url.search}`;

  const encabezados = new Headers();
  for (const h of ENCABEZADOS_REENVIADOS) {
    const v = request.headers.get(h);
    if (v) encabezados.set(h, v);
  }
  if (env?.VIAJES_ACCESS_CLIENT_ID && env.VIAJES_ACCESS_CLIENT_SECRET) {
    encabezados.set("CF-Access-Client-Id", env.VIAJES_ACCESS_CLIENT_ID);
    encabezados.set("CF-Access-Client-Secret", env.VIAJES_ACCESS_CLIENT_SECRET);
  }

  const conCuerpo = request.method !== "GET" && request.method !== "HEAD";
  let r: Response;
  try {
    r = await fetch(destino, {
      method: request.method,
      headers: encabezados,
      body: conCuerpo ? await request.arrayBuffer() : undefined,
      redirect: "manual",
    });
  } catch (e) {
    return new Response(`No se pudo abrir la bitácora de viajes: ${(e as Error).message}`, { status: 502 });
  }
  if (r.status >= 300 && r.status < 400) {
    return new Response(
      "La bitácora de viajes pide el login de Cloudflare Access: falta el service token (VIAJES_ACCESS_CLIENT_ID/SECRET).",
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const salida = new Headers();
  for (const h of ENCABEZADOS_DEVUELTOS) {
    const v = r.headers.get(h);
    if (v) salida.set(h, v);
  }
  return new Response(r.body, { status: r.status, headers: salida });
}
