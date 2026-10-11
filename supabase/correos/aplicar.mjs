// Aplica los correos de FinanzasPersonales (plantillas de este directorio) y,
// si hay secretos SMTP, el remitente propio al proyecto de Supabase de
// clientes, por la Management API. Lo corre .github/workflows/correos-producto.yml;
// así los correos quedan versionados aquí y no se pegan a mano en el panel.
//
//   node supabase/correos/aplicar.mjs --vista DIR   # solo escribe los HTML armados en DIR
//
// Variables: SUPABASE_ACCESS_TOKEN, PROYECTO (ref del proyecto), SMTP_PASS y
// SMTP_REMITENTE (+ SMTP_HOST, SMTP_PUERTO, SMTP_USUARIO; por omisión los de
// Resend). Sin SMTP no aplica nada: el plan gratuito de Supabase rechaza
// cambiar plantillas con su remitente incluido.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const NOMBRE_REMITENTE = "Ordena tu Lana";
const CORREO_CONTACTO = "contacto@ordenatulana.com";
// A dónde llevan los enlaces de los correos ({{ .SiteURL }}) y a qué
// direcciones puede volver Supabase después de confirmar/recuperar. Versionado
// aquí para no depender del panel (Authentication → URL Configuration).
const SITIO = "https://ordenatulana.com";
const REDIRECCIONES = [
  "https://ordenatulana.com/**",
  "https://www.ordenatulana.com/**",
  "https://pruebas.ordenatulana.pages.dev/**",
];
// Tope de correos de auth por hora con SMTP propio (el de Supabase es fijo y bajo).
const CORREOS_POR_HORA = 100;

// archivo → campos de la Management API (PATCH /v1/projects/{ref}/config/auth)
const CORREOS = [
  { archivo: "confirmacion.html", campo: "confirmation" },
  { archivo: "recuperacion.html", campo: "recovery" },
  { archivo: "cambio-correo.html", campo: "email_change" },
];

const leer = (archivo) => readFileSync(join(DIR, archivo), "utf8");

/** Arma un correo: su contenido dentro de base.html, con el botón y el asunto
 * tomados de los comentarios <!--BOTON: tipo | texto--> y <!--ASUNTO: …-->. */
export function armarCorreo(archivo) {
  const fuente = leer(archivo);
  const asunto = fuente.match(/<!--ASUNTO: (.+?)-->/)?.[1];
  if (!asunto) throw new Error(`${archivo}: falta <!--ASUNTO: …-->`);
  const contenido = fuente
    .replace(/<!--ASUNTO: .+?-->\n/, "")
    .replace(/<!--BOTON: (\w+) \| (.+?)-->/, (_, tipo, texto) =>
      leer("boton.html").replaceAll("TIPO", tipo).replace("TEXTO", texto).trimEnd()
    );
  if (contenido.includes("<!--")) throw new Error(`${archivo}: quedó un marcador sin reemplazar`);
  const html = leer("base.html").replace("<!--CONTENIDO-->", contenido.trimEnd()).replace("CORREO_CONTACTO", CORREO_CONTACTO);
  return { asunto, html };
}

export function configuracionAuth(entorno) {
  const cuerpo = { site_url: SITIO, uri_allow_list: REDIRECCIONES.join(",") };
  for (const { archivo, campo } of CORREOS) {
    const { asunto, html } = armarCorreo(archivo);
    cuerpo[`mailer_subjects_${campo}`] = asunto;
    cuerpo[`mailer_templates_${campo}_content`] = html;
  }
  if (entorno.SMTP_PASS && entorno.SMTP_REMITENTE) {
    Object.assign(cuerpo, {
      smtp_host: entorno.SMTP_HOST || "smtp.resend.com",
      smtp_port: entorno.SMTP_PUERTO || "465",
      smtp_user: entorno.SMTP_USUARIO || "resend",
      smtp_pass: entorno.SMTP_PASS,
      smtp_admin_email: entorno.SMTP_REMITENTE,
      smtp_sender_name: NOMBRE_REMITENTE,
      rate_limit_email_sent: CORREOS_POR_HORA,
    });
  }
  return cuerpo;
}

async function main() {
  const i = process.argv.indexOf("--vista");
  if (i !== -1) {
    const destino = process.argv[i + 1];
    mkdirSync(destino, { recursive: true });
    for (const { archivo } of CORREOS) {
      const { asunto, html } = armarCorreo(archivo);
      writeFileSync(join(destino, archivo), html);
      console.log(`${archivo}: ${asunto}`);
    }
    return;
  }

  const { SUPABASE_ACCESS_TOKEN: token, PROYECTO: proyecto } = process.env;
  if (!token || !proyecto) throw new Error("Faltan SUPABASE_ACCESS_TOKEN o PROYECTO.");
  const cuerpo = configuracionAuth(process.env);
  // En el plan gratuito, Supabase no deja cambiar las plantillas mientras se
  // use su remitente incluido: sin SMTP propio no hay nada que aplicar.
  if (!("smtp_host" in cuerpo)) {
    console.log(
      "::notice::Sin PRODUCTO_SMTP_PASS / PRODUCTO_SMTP_REMITENTE no se aplican los correos: el plan gratuito de Supabase solo permite cambiar las plantillas con un SMTP propio."
    );
    return;
  }
  const respuesta = await fetch(`https://api.supabase.com/v1/projects/${proyecto}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!respuesta.ok) throw new Error(`Supabase respondió ${respuesta.status}: ${await respuesta.text()}`);
  console.log(`Correos aplicados (${CORREOS.length} plantillas). Sitio: ${SITIO}.`);
  console.log(`Remitente: ${NOMBRE_REMITENTE} <${process.env.SMTP_REMITENTE}> por ${cuerpo.smtp_host}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
