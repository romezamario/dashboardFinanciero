// Correos propios de Ordena tu Lana sobre la suscripción (plan activo, plan
// cancelado). Mercado Pago manda sus comprobantes al correo del pagador; estos
// van al correo con el que el cliente entra a la app, con nuestra marca.
// Diseño elegido por Mario (2026-10-13, "combina el A con el C"): banda azul con
// el titular, recibo en una caja, tres pasos para empezar a ordenar, la meta de
// gasto diario con una semana de ejemplo y un consejo. Todo con tablas y estilos
// en línea (Gmail/Outlook no leen <style> ni flex). Sin Deno: lo prueba Vitest.

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

function primerNombre(nombre: string | null): string | null {
  return nombre?.trim().split(/\s+/)[0] || null;
}

const FUENTE = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const AZUL = "#1073ee";
const MARINO = "#04152b";
const VERDE = "#0ca30c";
// Logo de la marca sobre la franja marino (frontend/public/marca/, publicado en el sitio).
const LOGO_SOBRE_MARINO = "https://ordenatulana.com/marca/correo-logo-marino.png";
const GRIS = "#52514e";
const GRIS_CLARO = "#76756f";

/** Un bloque del cuerpo: su HTML y su versión en texto plano. */
interface Bloque {
  html: string;
  texto: string;
}

const parrafo = (html: string, texto: string, extra = ""): Bloque => ({
  html: `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:${GRIS};${extra}">${html}</p>`,
  texto,
});

function recibo(filas: [string, string][]): Bloque {
  const html = filas
    .map(
      ([k, v], i) => `<tr>
                      <td style="padding:${i ? 6 : 0}px 0 0;font-size:14px;color:${GRIS_CLARO};">${escapar(k)}</td>
                      <td align="right" style="padding:${i ? 6 : 0}px 0 0;font-size:14px;font-weight:600;color:#020d21;">${escapar(v)}</td>
                    </tr>`
    )
    .join("\n");
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px dashed #c9d2dc;border-radius:10px;">
                <tr><td style="padding:14px 16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${html}
                  </table>
                </td></tr>
              </table>`,
    texto: filas.map(([k, v]) => `${k}: ${v}`).join("\n"),
  };
}

function pasos(titulo: string, lista: [string, string][]): Bloque {
  const filas = lista
    .map(
      ([t, d], i) => `<tr>
                  <td width="38" valign="top" style="padding:0 0 12px;">
                    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                      <td width="26" height="26" align="center" style="width:26px;height:26px;border-radius:13px;background:#e8f0fb;color:${MARINO};font-size:13px;font-weight:700;">${i + 1}</td>
                    </tr></table>
                  </td>
                  <td valign="top" style="padding:2px 0 12px;font-size:14px;line-height:20px;color:${GRIS};">
                    <strong style="color:#020d21;">${escapar(t)}</strong><br />${escapar(d)}
                  </td>
                </tr>`
    )
    .join("\n");
  return {
    html: `<p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#020d21;">${escapar(titulo)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
${filas}
              </table>`,
    texto: [titulo, ...lista.map(([t, d], i) => `${i + 1}. ${t}: ${d}`)].join("\n"),
  };
}

/** Semana de ejemplo de la meta diaria (cifras inventadas y marcadas así). */
const SEMANA_EJEMPLO: [string, number, string][] = [
  ["Dom", 420, "#dff1e7"],
  ["Lun", 610, "#e3f2df"],
  ["Mar", 1850, "#fbe3d6"],
  ["Mié", 380, "#dff1e7"],
  ["Jue", 990, "#f1efd6"],
  ["Vie", 700, "#e3f2df"],
  ["Sáb", 650, "#dff1e7"],
];

function metaDiaria(): Bloque {
  const dias = SEMANA_EJEMPLO.map(
    ([d, m, c]) =>
      `<td align="center" style="padding:6px 2px;background:${c};border:2px solid #f7f9fb;border-radius:6px;font-size:11px;line-height:15px;color:#3c3f45;"><span style="font-size:10px;font-weight:600;color:${GRIS_CLARO};">${d}</span><br />${pesos(m)}</td>`
  ).join("\n                      ");
  const promedio = SEMANA_EJEMPLO.reduce((s, [, m]) => s + m, 0) / SEMANA_EJEMPLO.length;
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;background:#f7f9fb;border:1px solid #e3e6ea;border-radius:10px;">
                <tr><td style="padding:16px;">
                  <p style="margin:0 0 4px;font-size:14px;color:${GRIS};">Ponte una meta de gasto diario, por ejemplo:</p>
                  <p style="margin:0 0 12px;font-size:34px;line-height:38px;font-weight:800;color:${VERDE};">${pesos(1000)} <span style="font-size:15px;font-weight:600;color:${GRIS};">al día</span></p>
                  <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8a8d93;">Ejemplo de una semana</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
                    <tr>
                      ${dias}
                    </tr>
                  </table>
                  <p style="margin:10px 0 0;font-size:13px;line-height:19px;color:${GRIS};"><strong style="color:${VERDE};">✓ ${pesos(1000 - promedio)} por debajo</strong> de la meta: promedio de ${pesos(promedio)} al día. Cada semana te mostramos si vas arriba o abajo.</p>
                </td></tr>
              </table>`,
    texto: `Por ejemplo, ${pesos(1000)} al día. Cada semana te mostramos si vas arriba o abajo.`,
  };
}

function consejo(titulo: string, cuerpo: string): Bloque {
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#fff8e6;border:1px solid #f1dfae;border-radius:10px;">
                <tr><td style="padding:12px 14px;font-size:14px;line-height:20px;color:#5a4a1e;"><strong style="color:#3d3214;">${escapar(titulo)}</strong> ${escapar(cuerpo)}</td></tr>
              </table>`,
    texto: `${titulo} ${cuerpo}`,
  };
}

function armar(datos: {
  asunto: string;
  titulo: string;
  subtitulo: string;
  bloques: Bloque[];
  boton: { texto: string; url: string };
  nota: string;
}): Correo {
  const html = `<!doctype html>
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
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;font-family:${FUENTE};color:#020d21;">
            <tr>
              <td style="background:${MARINO};border-radius:12px 12px 0 0;padding:24px 24px 26px;">
                <img src="${LOGO_SOBRE_MARINO}" width="133" height="48" alt="Ordena tu Lana" style="display:block;border:0;width:133px;height:48px;font-size:17px;font-weight:700;color:#ffffff;" />
                <h1 style="margin:18px 0 6px;font-size:24px;line-height:31px;color:#ffffff;">${datos.titulo}</h1>
                <p style="margin:0;font-size:15px;line-height:22px;color:#c9d6ea;">${datos.subtitulo}</p>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e3e6ea;border-top:0;border-radius:0 0 12px 12px;padding:24px;">
              ${datos.bloques.map((b) => b.html).join("\n              ")}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">
                  <tr>
                    <td style="border-radius:8px;background:${AZUL};">
                      <a href="${escapar(datos.boton.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapar(datos.boton.texto)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;line-height:20px;color:${GRIS_CLARO};">${datos.nota}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 4px 0;font-size:12px;line-height:18px;color:${GRIS_CLARO};">
                Este correo es de Ordena tu Lana. ¿Dudas? Escríbenos a ${CORREO_CONTACTO}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const sinEtiquetas = (s: string) =>
    s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  const texto = [
    sinEtiquetas(datos.titulo),
    sinEtiquetas(datos.subtitulo),
    "",
    ...datos.bloques.flatMap((b) => [b.texto, ""]),
    `${datos.boton.texto}: ${datos.boton.url}`,
    "",
    sinEtiquetas(datos.nota),
  ].join("\n");
  return { asunto: datos.asunto, html, texto };
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
  const nombre = primerNombre(datos.nombre);
  const filas: [string, string][] = [
    ["Plan", `${datos.plan} ${datos.periodo}`],
    ["Pagaste", pesos(datos.monto)],
    datos.proximoCobro
      ? ["Próximo cobro", `${pesos(datos.monto)} el ${fechaCorreo(datos.proximoCobro)}`]
      : ["Se cobra", `cada ${datos.periodo === "anual" ? "año" : "mes"}`],
  ];
  const bloques: Bloque[] = [recibo(filas)];
  if (datos.cambioDePlan) bloques.push(parrafo("Tu plan anterior ya no se cobrará.", "Tu plan anterior ya no se cobrará."));
  bloques.push(
    pasos("Empieza a ordenar tu lana en 3 pasos", [
      ["Sube tu estado de cuenta", "En PDF o con nuestra plantilla de Excel."],
      ["Mira en qué se va tu dinero", "Tus gastos llegan separados por categoría y por tarjeta."],
      ["Ponte una meta diaria", "Así sabes cuánto puedes gastar hoy. Mira el ejemplo:"],
    ]),
    metaDiaria(),
    consejo(
      "Consejo para empezar:",
      'los gastos de menos de $200 son los que más se escapan. En tu tablero aparecen juntos como "gasto hormiga".'
    )
  );
  return armar({
    asunto: `${nombre ? `${nombre}, tu` : "Tu"} plan ${datos.plan} está activo: empieza a ordenar tu lana`,
    titulo: `${nombre ? `¡Listo, ${escapar(nombre)}!` : "¡Listo!"} Tu plan ${escapar(datos.plan)} ya está activo.`,
    subtitulo: "Gracias por suscribirte. Ahora sí: cada peso que entra y sale, en su lugar.",
    bloques,
    boton: { texto: "Empezar a ordenar mi lana", url: datos.sitio },
    nota: "Puedes cambiar de plan o cancelar cuando quieras en Mi cuenta. El cobro lo procesa Mercado Pago.",
  });
}

export function correoPlanCancelado(datos: {
  nombre: string | null;
  plan: string;
  periodo: "mensual" | "anual";
  hasta: string | null;
  sitio: string;
}): Correo {
  const nombre = primerNombre(datos.nombre);
  const filas: [string, string][] = [["Plan cancelado", `${datos.plan} ${datos.periodo}`]];
  if (datos.hasta) filas.push(["Lo sigues usando hasta el", fechaCorreo(datos.hasta)]);
  filas.push(["Después", "plan Gratis"]);
  return armar({
    asunto: `Cancelaste tu plan ${datos.plan} ${datos.periodo}`,
    titulo: `${nombre ? `${escapar(nombre)}, tu` : "Tu"} suscripción quedó cancelada.`,
    subtitulo: "Ya no se te volverá a cobrar.",
    bloques: [
      recibo(filas),
      parrafo(
        "Tus movimientos, cuentas y categorías no se borran: siguen ahí si vuelves.",
        "Tus movimientos, cuentas y categorías no se borran: siguen ahí si vuelves."
      ),
      consejo(
        "Mientras tanto:",
        "revisa tu meta de gasto diario de esta semana; es la forma más rápida de ver si tu lana sigue en orden."
      ),
    ],
    boton: { texto: "Abrir mi tablero", url: datos.sitio },
    nota: "¿Cambiaste de opinión? Puedes volver a suscribirte en Mi cuenta. Si no fuiste tú, escríbenos.",
  });
}
