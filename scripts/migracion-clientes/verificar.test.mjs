// node --test scripts/migracion-clientes/verificar.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REDIRECCIONES,
  SITIO,
  compararHuellas,
  consultaHuellaTabla,
  corto,
  diferenciasAuth,
  migracionesDelRepo,
  problemasConfigAuth,
  refsEnTexto,
} from "./verificar.mjs";

const configBuena = {
  site_url: SITIO,
  uri_allow_list: REDIRECCIONES.join(","),
  smtp_host: "smtp.resend.com",
  mailer_autoconfirm: false,
  disable_signup: false,
  mailer_templates_confirmation_content: '<a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=email">',
};

test("la configuración de Auth esperada no tiene problemas", () => {
  assert.deepEqual(problemasConfigAuth(configBuena), []);
});

test("detecta sitio, redirección, SMTP y plantilla equivocados", () => {
  const p = problemasConfigAuth({ ...configBuena, site_url: "http://localhost:3000", uri_allow_list: REDIRECCIONES[0], smtp_host: "", mailer_templates_confirmation_content: "{{ .ConfirmationURL }}" });
  assert.equal(p.length, 5);
});

test("compararHuellas encuentra tablas con filas o contenido distinto", () => {
  const a = { "public.planes": { filas: 3, huella: "x" }, "auth.users": { filas: 5, huella: "u" }, "public.perfiles": { filas: 5, huella: "p" } };
  const b = { "public.planes": { filas: 3, huella: "x" }, "auth.users": { filas: 5, huella: "otra" } };
  assert.deepEqual(compararHuellas(a, b), ["auth.users", "public.perfiles"]);
  assert.deepEqual(compararHuellas(a, structuredClone(a)), []);
});

test("diferenciasAuth compara solo los ajustes listados", () => {
  assert.deepEqual(diferenciasAuth({ site_url: "a", smtp_pass: "x" }, { site_url: "a", smtp_pass: "y" }), []);
  assert.deepEqual(diferenciasAuth({ jwt_exp: 3600 }, { jwt_exp: 7200 }), ["jwt_exp"]);
});

test("refsEnTexto saca los proyectos de Supabase del JavaScript", () => {
  const js = 'const u="https://qlijgngqbsgxwaxapuqu.supabase.co";fetch("https://abcdefghijklmnopqrst.supabase.co/rest/v1")';
  assert.deepEqual(refsEnTexto(js), ["qlijgngqbsgxwaxapuqu", "abcdefghijklmnopqrst"]);
});

test("las consultas de huella no exponen columnas que cambian al iniciar sesión", () => {
  const q = consultaHuellaTabla("auth.users");
  assert.ok(q.includes("encrypted_password"));
  assert.ok(!q.includes("last_sign_in_at"));
  assert.ok(consultaHuellaTabla("public.planes").includes('"public"."planes"'));
});

test("lee las versiones de migración del repo", () => {
  const v = migracionesDelRepo();
  assert.ok(v.length > 20);
  assert.ok(v.every((x) => /^\d{14}$/.test(x)));
});

test("corto nunca imprime la ref completa", () => {
  assert.equal(corto("qlijgngqbsgxwaxapuqu"), "qlij…puqu");
});
