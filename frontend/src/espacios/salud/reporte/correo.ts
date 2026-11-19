// Mensaje MIME del reporte semanal (texto + HTML) y su envío por SMTP con TLS
// directo (puerto 465; Gmail con contraseña de aplicación). Sin dependencias:
// el workflow solo corre `node`. Se usa desde enviar.ts, nunca en el navegador.
/// <reference types="node" />
import { connect, type TLSSocket } from "node:tls";

export interface Correo {
  de: string;
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

const base64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
/** Base64 en renglones de 76 (RFC 2045). */
const enRenglones = (s: string) => base64(s).replace(/.{1,76}/g, "$&\r\n");

/** Encabezados + partes. Todo va en base64, así un "." al inicio de renglón
 * nunca corta el DATA de SMTP y los acentos llegan intactos. */
export function armarMensaje(c: Correo, fecha = new Date(), frontera = `=_salud_${fecha.getTime().toString(36)}`): string {
  return [
    `From: Salud <${c.de}>`,
    `To: ${c.para}`,
    `Subject: =?UTF-8?B?${base64(c.asunto)}?=`,
    `Date: ${fecha.toUTCString().replace("GMT", "+0000")}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${frontera}"`,
    "",
    `--${frontera}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    enRenglones(c.texto),
    `--${frontera}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    enRenglones(c.html),
    `--${frontera}--`,
    "",
  ].join("\r\n");
}

export interface ServidorSmtp {
  host: string;
  puerto: number;
  usuario: string;
  contrasena: string;
}

/** Lee respuestas SMTP completas (las de varias líneas terminan con "NNN "). */
function lector(sock: TLSSocket) {
  let bufer = "";
  const esperando: ((r: string) => void)[] = [];
  sock.setEncoding("utf8");
  sock.on("data", (d: string) => {
    bufer += d;
    for (;;) {
      const m = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(bufer);
      if (!m) break;
      const fin = m.index + m[0].length;
      const respuesta = bufer.slice(0, fin);
      bufer = bufer.slice(fin);
      esperando.shift()?.(respuesta);
    }
  });
  return () => new Promise<string>((ok) => esperando.push(ok));
}

export async function enviarSmtp(s: ServidorSmtp, c: Correo): Promise<void> {
  const sock = await new Promise<TLSSocket>((ok, mal) => {
    const t = connect({ host: s.host, port: s.puerto, servername: s.host }, () => ok(t));
    t.once("error", mal);
    t.setTimeout(30_000, () => t.destroy(new Error("SMTP: se agotó el tiempo")));
  });
  const leer = lector(sock);
  const paso = async (comando: string | null, codigo: number, nombre: string) => {
    const respuesta = leer();
    if (comando !== null) sock.write(`${comando}\r\n`);
    const r = await respuesta;
    // Solo el código: el texto puede repetir el usuario (y el log del workflow es público).
    const ultima = r.trimEnd().split("\r\n").at(-1) ?? "";
    if (!ultima.startsWith(`${codigo} `)) throw new Error(`SMTP: ${nombre} respondió ${ultima.slice(0, 3)} (se esperaba ${codigo})`);
  };
  try {
    await paso(null, 220, "saludo");
    await paso("EHLO reporte-salud", 250, "EHLO");
    await paso("AUTH LOGIN", 334, "AUTH");
    await paso(base64(s.usuario), 334, "usuario");
    await paso(base64(s.contrasena), 235, "contraseña");
    await paso(`MAIL FROM:<${c.de}>`, 250, "MAIL FROM");
    await paso(`RCPT TO:<${c.para}>`, 250, "RCPT TO");
    await paso("DATA", 354, "DATA");
    await paso(`${armarMensaje(c)}\r\n.`, 250, "mensaje");
    await paso("QUIT", 221, "QUIT").catch(() => {});
  } finally {
    sock.end();
  }
}
