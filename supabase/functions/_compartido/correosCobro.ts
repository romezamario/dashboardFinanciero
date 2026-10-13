// Correos propios de Ordena tu Lana sobre la suscripción (plan activo, plan
// cancelado). Mercado Pago manda sus comprobantes al correo del pagador; estos
// van al correo con el que el cliente entra a la app, con nuestra marca. Mismo
// marco que las plantillas de auth (supabase/correos/base.html). Sin Deno:
// lo prueba Vitest.

export const CORREO_CONTACTO = "contacto@ordenatulana.com";

export interface Correo {
  asunto: string;
  html: string;
  texto: string;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2027-10-13T…" → "13 oct 2027" (la fecha tal como la guarda Mercado Pago, sin zona). */
export function fechaCorreo(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${a}`;
}

export const pesos = (monto: number) =>
  `$${monto.toLocaleString("es-MX", { minimumFractionDigits: Number.isInteger(monto) ? 0 : 2, maximumFractionDigits: 2 })}`;

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function saludo(nombre: string | null): string {
  const limpio = nombre?.trim().split(/\s+/)[0];
  return limpio ? `Hola, ${limpio}` : "Hola";
}

function marco(titulo: string, parrafos: string[], boton: { texto: string; url: string }, nota: string): string {
  const cuerpo = parrafos
    .map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#52514e;">${p}</p>`)
    .join("\n");
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Ordena tu Lana</title>
  </head>
  <body style="margin:0;padding:0;background:#f9f9f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0b0b;">
            <tr>
              <td style="padding:0 4px 16px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="28" height="28" align="center" style="width:28px;height:28px;border-radius:6px;background:#2a78d6;color:#ffffff;font-size:14px;font-weight:700;">$</td>
                    <td style="padding-left:8px;font-size:17px;font-weight:600;">Ordena tu Lana</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e7e7e4;border-radius:12px;padding:28px 24px;">
                <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;">${titulo}</h1>
${cuerpo}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
                  <tr>
                    <td style="border-radius:8px;background:#2a78d6;">
                      <a href="${escapar(boton.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${boton.texto}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;line-height:20px;color:#76756f;">${nota}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 4px 0;font-size:12px;line-height:18px;color:#76756f;">
                Este correo es de Ordena tu Lana. ¿Dudas? Escríbenos a ${CORREO_CONTACTO}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const sinEtiquetas = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

function armar(asunto: string, titulo: string, parrafos: string[], boton: { texto: string; url: string }, nota: string): Correo {
  const texto = [sinEtiquetas(titulo), "", ...parrafos.map(sinEtiquetas), "", `${boton.texto}: ${boton.url}`, "", sinEtiquetas(nota)].join("\n");
  return { asunto, html: marco(titulo, parrafos, boton, nota), texto };
}

export function correoPlanActivo(datos: {
  nombre: string | null;
  plan: string;
  periodo: "mensual" | "anual";
  monto: number;
  proximoCobro: string | null;
  cambioDePlan: boolean;
  sitio: string;
}): Correo {
  const plan = escapar(`${datos.plan} ${datos.periodo}`);
  const parrafos = [
    `Tu plan <strong>${plan}</strong> ya está activo. Gracias por suscribirte.`,
    datos.proximoCobro
      ? `Pagaste ${pesos(datos.monto)}. Tu próximo cobro será de ${pesos(datos.monto)} el ${fechaCorreo(datos.proximoCobro)}.`
      : `Pagaste ${pesos(datos.monto)}. El cobro se repite cada ${datos.periodo === "anual" ? "año" : "mes"}.`,
  ];
  if (datos.cambioDePlan) parrafos.push("Tu plan anterior ya no se cobrará.");
  return armar(
    `Tu plan ${datos.plan} ${datos.periodo} está activo`,
    `${escapar(saludo(datos.nombre))}, ¡ya tienes ${escapar(datos.plan)}!`,
    parrafos,
    { texto: "Abrir mi tablero", url: datos.sitio },
    "Puedes cambiar de plan o cancelar cuando quieras en Mi cuenta. El cobro lo procesa Mercado Pago."
  );
}

export function correoPlanCancelado(datos: {
  nombre: string | null;
  plan: string;
  periodo: "mensual" | "anual";
  hasta: string | null;
  sitio: string;
}): Correo {
  const plan = escapar(`${datos.plan} ${datos.periodo}`);
  return armar(
    `Cancelaste tu plan ${datos.plan} ${datos.periodo}`,
    `${escapar(saludo(datos.nombre))}, tu suscripción quedó cancelada`,
    [
      `Cancelaste tu plan <strong>${plan}</strong>. Ya no se te volverá a cobrar.`,
      datos.hasta
        ? `Lo sigues usando hasta el ${fechaCorreo(datos.hasta)}; después pasas al plan Gratis. Tus movimientos y cuentas no se borran.`
        : "Después pasas al plan Gratis. Tus movimientos y cuentas no se borran.",
    ],
    { texto: "Abrir mi tablero", url: datos.sitio },
    "¿Cambiaste de opinión? Puedes volver a suscribirte en Mi cuenta. Si no fuiste tú, escríbenos."
  );
}
