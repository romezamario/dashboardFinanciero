// Autoriza Gmail desde el dashboard (2026-11-20, Mario: "no quiero que la
// autorización sea en desktop, también quiero que sea a través del dashboard
// si es que expira"). Flujo OAuth de Google con un cliente "Aplicación web"
// (GMAIL_WEB_CLIENT_ID / GMAIL_WEB_CLIENT_SECRET, secretos de la función que
// pone funciones.yml); el permiso queda en privado.gmail_conexiones igual que
// el que sube la app de escritorio, y revisar-gmail lo usa sin distinguirlos.
//
// * POST con la sesión del usuario, {origen}: guarda un state de un solo uso
//   (15 min) y devuelve la URL de Google a la que el navegador debe ir.
// * GET ?code&state (Google regresa aquí, sin sesión — por eso verify_jwt =
//   false): toma el state, cambia el code por el refresh token, guarda la
//   conexión y redirige al dashboard con ?gmail=conectado|cancelado|error.
//
// La URL de esta función debe estar en "URI de redireccionamiento
// autorizados" del cliente web en Google Cloud (README, "Gmail en la nube").
import { createClient } from "npm:@supabase/supabase-js@2";
import { concedioGmail, direccionDeRegreso, nuevoEstado, urlAutorizacion, urlResultado } from "./oauth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const redirigir = (url: string) => new Response(null, { status: 302, headers: { Location: url } });
const pagina = (estado: number, texto: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gmail</title>` +
      `<p style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5">${texto}</p>`,
    { status: estado, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

const SIN_CLIENTE =
  "Falta configurar el cliente web de Google (GMAIL_WEB_CLIENT_ID y GMAIL_WEB_CLIENT_SECRET). " +
  "Mientras tanto, la app de escritorio puede reconectar Gmail.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const base = Deno.env.get("SUPABASE_URL")!;
  const redirect = `${base.replace(/\/$/, "")}/functions/v1/gmail-oauth`;
  const clientId = Deno.env.get("GMAIL_WEB_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GMAIL_WEB_CLIENT_SECRET") ?? "";
  const extra = (Deno.env.get("GMAIL_SITIOS_PERMITIDOS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const admin = createClient(base, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (req.method === "POST") {
    if (!clientId || !clientSecret) return responder(503, { error: SIN_CLIENTE });
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: sesion } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    if (!sesion?.user) return responder(401, { error: "Inicia sesión." });
    const cuerpo = await req.json().catch(() => ({}));
    const volver = direccionDeRegreso(String(cuerpo?.origen ?? ""), extra);
    if (!volver) return responder(400, { error: "Este sitio no puede conectar Gmail." });

    const { data: conexiones } = await admin.rpc("conexiones_gmail");
    const correo = ((conexiones ?? []) as { user_id: string; correo: string | null }[]).find((c) => c.user_id === sesion.user!.id)?.correo;
    const estado = nuevoEstado();
    const { error } = await admin.rpc("guardar_estado_oauth_gmail", { p_estado: estado, p_user_id: sesion.user.id, p_volver: volver });
    if (error) return responder(500, { error: error.message });
    return responder(200, { url: urlAutorizacion({ clientId, redirect, estado, correo }) });
  }

  if (req.method !== "GET") return responder(405, { error: "Método no permitido" });
  const params = new URL(req.url).searchParams;
  const estado = params.get("state") ?? "";
  if (!estado) return pagina(400, "Falta el parámetro state. Vuelve al dashboard y usa “Conectar Gmail”.");
  const { data: tomados, error: errorEstado } = await admin.rpc("tomar_estado_oauth_gmail", { p_estado: estado });
  const tomado = ((tomados ?? []) as { user_id: string; volver: string }[])[0];
  if (errorEstado || !tomado) {
    return pagina(400, "Este enlace de autorización ya se usó o venció (dura 15 minutos). Vuelve al dashboard y usa “Conectar Gmail” otra vez.");
  }
  const { user_id: userId, volver } = tomado;

  if (params.get("error")) return redirigir(urlResultado(volver, params.get("error") === "access_denied" ? "cancelado" : "error", params.get("error")!));
  const code = params.get("code");
  if (!code || !clientId || !clientSecret) return redirigir(urlResultado(volver, "error", code ? SIN_CLIENTE : "Google no mandó el código."));

  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: "authorization_code" }),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok || !datos.access_token) {
      return redirigir(urlResultado(volver, "error", `Google respondió ${r.status}: ${datos.error_description ?? datos.error ?? ""}`));
    }
    if (!concedioGmail(datos.scope)) return redirigir(urlResultado(volver, "sin_permiso"));
    if (!datos.refresh_token) return redirigir(urlResultado(volver, "error", "Google no devolvió un permiso permanente (refresh token)."));

    const perfil = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${datos.access_token}` },
    }).then((p) => (p.ok ? p.json() : null)).catch(() => null);

    const { error } = await admin.rpc("guardar_conexion_gmail_web", {
      p_user_id: userId,
      p_client_id: clientId,
      p_client_secret: clientSecret,
      p_refresh_token: datos.refresh_token,
      p_correo: perfil?.emailAddress ?? null,
    });
    if (error) return redirigir(urlResultado(volver, "error", error.message));
    return redirigir(urlResultado(volver, "conectado"));
  } catch (e) {
    console.error("gmail-oauth", userId, (e as Error).message);
    return redirigir(urlResultado(volver, "error", (e as Error).message));
  }
});
