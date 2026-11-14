// Verifica la instancia de clientes de Ordena tu Lana (Supabase) antes y
// después de la migración a la cuenta tecnologia@ordenatulana.com.
// Plan completo: docs/migracion-supabase-clientes.md.
//
// Solo LEE: consultas SQL de lectura por la Management API, GET a la API de
// datos con la anon key y GET a las funciones y al sitio. No escribe nada.
//
// Variables (las pasa .github/workflows/verificar-instancia-clientes.yml):
//   TOKEN, REF                 access token de la cuenta dueña y ref del proyecto
//   URL, ANON_KEY              URL pública del proyecto y su anon key
//   ORGANIZACION_ESPERADA      opcional: id (slug) de la organización que debe tenerlo
//   REF_ORIGEN, TOKEN_ORIGEN   opcional: el proyecto anterior, para comparar
//                              datos/usuarios/configuración (opción B)
//   SITIOS                     opcional: sitios cuyo JavaScript debe apuntar a REF
//
// El repositorio es público y los logs de Actions también: nunca se imprimen
// datos, conteos de clientes ni refs completas; solo "bien"/"mal" y huellas
// cortas.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const API = "https://api.supabase.com/v1";

export const FUNCIONES_ESPERADAS = [
  "crear-suscripcion",
  "cancelar-suscripcion",
  "verificar-suscripcion",
  "reiniciar-pagos",
  "webhook-mercadopago",
];
export const SECRETOS_ESPERADOS = ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET", "MP_ACCESS_TOKEN_PRODUCCION", "RESEND_API_KEY", "CORREO_REMITENTE"];
export const SITIO = "https://ordenatulana.com";
export const REDIRECCIONES = ["https://ordenatulana.com/**", "https://www.ordenatulana.com/**", "https://pruebas.ordenatulana.pages.dev/**"];
// Ajustes de Auth que deben ser iguales entre el proyecto viejo y el nuevo
// (opción B). Sin secretos (smtp_pass no se compara: la API no lo devuelve).
export const AJUSTES_AUTH_COMPARADOS = [
  "site_url",
  "uri_allow_list",
  "disable_signup",
  "mailer_autoconfirm",
  "mailer_secure_email_change_enabled",
  "password_min_length",
  "password_required_characters",
  "jwt_exp",
  "refresh_token_rotation_enabled",
  "security_refresh_token_reuse_interval",
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_admin_email",
  "smtp_sender_name",
  "rate_limit_email_sent",
  "mailer_subjects_confirmation",
  "mailer_subjects_recovery",
  "mailer_subjects_email_change",
  "mailer_templates_confirmation_content",
  "mailer_templates_recovery_content",
  "mailer_templates_email_change_content",
  "external_email_enabled",
  "external_google_enabled",
];

/** Una huella por tabla: filas ordenadas → md5. Para auth.users solo columnas
 * que no cambian al iniciar sesión (la contraseña cifrada incluida: si coincide,
 * las contraseñas de los clientes siguen sirviendo). */
export const CONSULTA_HUELLAS = `
with t as (
  select 'public.' || c.relname as tabla, c.oid
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
)
select tabla from t order by tabla;`;

export function consultaHuellaTabla(tabla) {
  if (tabla === "auth.users")
    return `select count(*)::int as filas, coalesce(md5(string_agg(x, '|' order by x)), '') as huella from (select id::text || coalesce(email,'') || coalesce(encrypted_password,'') || coalesce(email_confirmed_at::text,'') || coalesce(created_at::text,'') || coalesce(raw_user_meta_data::text,'') as x from auth.users) s;`;
  if (tabla === "auth.identities")
    return `select count(*)::int as filas, coalesce(md5(string_agg(x, '|' order by x)), '') as huella from (select id::text || user_id::text || provider || coalesce(identity_data::text,'') as x from auth.identities) s;`;
  // Tabla de public: la fila completa como texto.
  const [esquema, nombre] = tabla.split(".");
  return `select count(*)::int as filas, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as huella from "${esquema}"."${nombre}" t;`;
}

export const CONSULTA_SEGURIDAD = `
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)::int as tablas_sin_rls,
  (select count(*) from pg_policies where schemaname = 'public')::int as politicas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))::int as definer_expuestas,
  (select count(*) from pg_trigger where tgname = 'crear_perfil_de_usuario' or tgfoid::regproc::text like '%crear_perfil_de_usuario%')::int as trigger_perfiles,
  (select coalesce(json_agg(version order by version), '[]'::json) from supabase_migrations.schema_migrations) as migraciones;`;

/** Versiones de migración que hay en el repo (AAAAMMDDHHMMSS). */
export function migracionesDelRepo(dir = join(DIR, "../../supabase/migrations")) {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .map((f) => f.slice(0, 14))
    .sort();
}

/** Compara las huellas de dos proyectos: devuelve las tablas distintas. */
export function compararHuellas(origen, destino) {
  const tablas = [...new Set([...Object.keys(origen), ...Object.keys(destino)])].sort();
  return tablas.filter((t) => origen[t]?.huella !== destino[t]?.huella || origen[t]?.filas !== destino[t]?.filas);
}

/** Revisa la configuración de Auth que esperamos en la instancia de clientes. */
export function problemasConfigAuth(config) {
  const problemas = [];
  if (config.site_url !== SITIO) problemas.push(`site_url no es ${SITIO}`);
  const lista = String(config.uri_allow_list ?? "").split(",").map((s) => s.trim());
  for (const r of REDIRECCIONES) if (!lista.includes(r)) problemas.push(`falta la redirección ${r}`);
  if (!config.smtp_host) problemas.push("sin SMTP propio (los correos saldrían de Supabase)");
  if (config.mailer_autoconfirm) problemas.push("la confirmación de correo está apagada");
  if (config.disable_signup) problemas.push("el registro está apagado");
  if (!String(config.mailer_templates_confirmation_content ?? "").includes("token_hash")) problemas.push("la plantilla de confirmación no es la de Ordena tu Lana");
  return problemas;
}

export function diferenciasAuth(origen, destino) {
  return AJUSTES_AUTH_COMPARADOS.filter((k) => JSON.stringify(origen[k] ?? null) !== JSON.stringify(destino[k] ?? null));
}

/** Busca, en el JavaScript publicado de un sitio, a qué proyecto apunta. */
export function refsEnTexto(texto) {
  return [...new Set([...texto.matchAll(/https:\/\/([a-z0-9]{20})\.supabase\.co/g)].map((m) => m[1]))];
}

export const corto = (ref) => (ref ? `${ref.slice(0, 4)}…${ref.slice(-4)}` : "?");

// ---------------------------------------------------------------- red

async function api(token, ruta, opciones = {}) {
  const r = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opciones.headers ?? {}) },
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${ruta.replace(/[a-z0-9]{20}/g, (m) => corto(m))}: HTTP ${r.status}`);
  return texto ? JSON.parse(texto) : null;
}

const sql = (token, ref, query) => api(token, `/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query }) });

async function huellas(token, ref) {
  const tablas = (await sql(token, ref, CONSULTA_HUELLAS)).map((f) => f.tabla);
  const resultado = {};
  for (const tabla of [...tablas, "auth.users", "auth.identities"]) {
    const [fila] = await sql(token, ref, consultaHuellaTabla(tabla));
    resultado[tabla] = fila;
  }
  return resultado;
}

async function principal() {
  const e = process.env;
  const resultados = [];
  const anotar = (bien, que, detalle = "") => {
    resultados.push({ bien, que, detalle });
    console.log(`${bien ? "✓" : "✗"} ${que}${detalle ? ` — ${detalle}` : ""}`);
  };
  const intentar = async (que, fn) => {
    try {
      await fn();
    } catch (error) {
      anotar(false, que, error.message);
    }
  };
  if (!e.TOKEN || !e.REF) throw new Error("Faltan TOKEN y REF.");
  console.log(`Proyecto ${corto(e.REF)}${e.REF_ORIGEN ? `, comparado con ${corto(e.REF_ORIGEN)}` : ""}`);

  // 1. El token de la cuenta nueva ve el proyecto, y está en la organización correcta.
  await intentar("Proyecto accesible con el token", async () => {
    const p = await api(e.TOKEN, `/projects/${e.REF}`);
    anotar(p.status === "ACTIVE_HEALTHY", "Proyecto activo", p.status);
    if (e.ORGANIZACION_ESPERADA) anotar(p.organization_id === e.ORGANIZACION_ESPERADA, "Proyecto en la organización de Ordena tu Lana");
  });

  // 2. Esquema y seguridad.
  await intentar("Esquema", async () => {
    const [s] = await sql(e.TOKEN, e.REF, CONSULTA_SEGURIDAD);
    anotar(s.tablas_sin_rls === 0, "Todas las tablas de public tienen RLS");
    anotar(s.definer_expuestas === 0, "Ninguna función SECURITY DEFINER expuesta en public");
    anotar(s.trigger_perfiles > 0, "Trigger que crea el perfil al registrarse");
    const aplicadas = (typeof s.migraciones === "string" ? JSON.parse(s.migraciones) : s.migraciones) ?? [];
    const faltan = migracionesDelRepo().filter((v) => !aplicadas.includes(v));
    anotar(faltan.length === 0, "Migraciones del repo aplicadas", faltan.length ? `faltan ${faltan.join(", ")}` : "");
    if (e.REF_ORIGEN && e.TOKEN_ORIGEN) {
      const [o] = await sql(e.TOKEN_ORIGEN, e.REF_ORIGEN, CONSULTA_SEGURIDAD);
      anotar(o.politicas === s.politicas, "Mismo número de políticas RLS que el proyecto anterior");
    }
  });

  // 3. Datos y usuarios iguales al proyecto anterior (solo opción B).
  if (e.REF_ORIGEN && e.TOKEN_ORIGEN) {
    await intentar("Datos", async () => {
      const [a, b] = await Promise.all([huellas(e.TOKEN_ORIGEN, e.REF_ORIGEN), huellas(e.TOKEN, e.REF)]);
      const distintas = compararHuellas(a, b);
      anotar(distintas.length === 0, "Mismos datos y usuarios (huella por tabla)", distintas.length ? `distintas: ${distintas.join(", ")}` : `${Object.keys(b).length} tablas`);
    });
  }

  // 4. Edge Functions desplegadas y con sus secretos.
  await intentar("Funciones", async () => {
    const funciones = await api(e.TOKEN, `/projects/${e.REF}/functions`);
    const nombres = funciones.filter((f) => f.status === "ACTIVE").map((f) => f.slug);
    const faltan = FUNCIONES_ESPERADAS.filter((f) => !nombres.includes(f));
    anotar(faltan.length === 0, "Edge Functions de cobro activas", faltan.length ? `faltan ${faltan.join(", ")}` : "");
    const webhook = funciones.find((f) => f.slug === "webhook-mercadopago");
    anotar(webhook?.verify_jwt === false, "El webhook de Mercado Pago no exige sesión");
    const secretos = (await api(e.TOKEN, `/projects/${e.REF}/secrets`)).map((s) => s.name);
    const sinSecreto = SECRETOS_ESPERADOS.filter((s) => !secretos.includes(s));
    anotar(sinSecreto.length === 0, "Secretos de Mercado Pago y Resend", sinSecreto.length ? `faltan ${sinSecreto.join(", ")}` : "");
  });

  // 5. Configuración de Auth (sitio, redirecciones, SMTP, plantillas).
  await intentar("Auth", async () => {
    const config = await api(e.TOKEN, `/projects/${e.REF}/config/auth`);
    const problemas = problemasConfigAuth(config);
    anotar(problemas.length === 0, "Configuración de Auth de Ordena tu Lana", problemas.join("; "));
    if (e.REF_ORIGEN && e.TOKEN_ORIGEN) {
      const anterior = await api(e.TOKEN_ORIGEN, `/projects/${e.REF_ORIGEN}/config/auth`);
      const dif = diferenciasAuth(anterior, config);
      anotar(dif.length === 0, "Auth igual al proyecto anterior", dif.join(", "));
    }
  });

  // 6. Lo que ve un visitante: API de datos y funciones por la URL pública.
  if (e.URL && e.ANON_KEY) {
    await intentar("API pública", async () => {
      const cab = { apikey: e.ANON_KEY, Authorization: `Bearer ${e.ANON_KEY}` };
      const planes = await fetch(`${e.URL}/rest/v1/planes?select=id`, { headers: cab });
      const filas = planes.ok ? await planes.json() : [];
      anotar(planes.ok && filas.length >= 3, "Planes visibles con la anon key", `HTTP ${planes.status}`);
      const privadas = await fetch(`${e.URL}/rest/v1/transacciones?select=id&limit=1`, { headers: cab });
      const filasPrivadas = privadas.ok ? await privadas.json() : null;
      anotar(privadas.ok && filasPrivadas.length === 0, "Un visitante sin sesión no ve transacciones", `HTTP ${privadas.status}`);
      const webhook = await fetch(`${e.URL}/functions/v1/webhook-mercadopago`);
      anotar(webhook.ok, "Webhook de Mercado Pago responde", `HTTP ${webhook.status}`);
      const salud = await fetch(`${e.URL}/auth/v1/health`, { headers: { apikey: e.ANON_KEY } });
      anotar(salud.ok, "Auth responde", `HTTP ${salud.status}`);
    });
  }

  // 7. El sitio publicado apunta al proyecto correcto (y ya no al anterior).
  for (const sitio of (e.SITIOS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    await intentar(`Sitio ${sitio}`, async () => {
      const html = await (await fetch(sitio)).text();
      const scripts = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
      let refs = [];
      for (const s of scripts) refs = refs.concat(refsEnTexto(await (await fetch(new URL(s, sitio))).text()));
      refs = [...new Set(refs)];
      anotar(refs.includes(e.REF) && (!e.REF_ORIGEN || !refs.includes(e.REF_ORIGEN)), `${sitio} usa el proyecto ${corto(e.REF)}`, refs.map(corto).join(", ") || "no se encontró ninguna URL de Supabase");
    });
  }

  const malos = resultados.filter((r) => !r.bien);
  const resumen = [
    `## Verificación de la instancia de clientes (${corto(e.REF)})`,
    "",
    ...resultados.map((r) => `- ${r.bien ? "✅" : "❌"} ${r.que}${r.detalle ? ` — ${r.detalle}` : ""}`),
    "",
    malos.length ? `**${malos.length} revisión(es) fallaron.**` : "**Todo bien.**",
  ].join("\n");
  if (e.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(e.GITHUB_STEP_SUMMARY, resumen + "\n");
  }
  if (malos.length) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
