// Lectura de los avisos de compra de Banamex que llegan a Gmail: port fiel de
// `sync/gmail_gastos.py` (la app de escritorio) para que la revisión en la nube
// guarde EXACTAMENTE lo mismo que guardaba la laptop. Funciones puras, sin red,
// probadas con Vitest (avisos.test.ts) contra los mismos HTML sintéticos que
// usan las pruebas de Python. Si cambias una regla aquí, cámbiala también allá.

export const CONSULTA_GMAIL = (dias: number) =>
  `from:notificaciones@banamex.com subject:Retiro newer_than:${dias}d`;

/** Códigos de 3 letras confirmados por el usuario (los demás vienen de
 * `ciudades_correo` en preferencias, el antiguo `data/gastos_correo/ciudades.json`). */
export const CIUDADES_CONFIRMADAS: Record<string, string> = { MCA: "McAllen", APO: "Apodaca" };
/** Códigos que son el PAÍS, no la ciudad: la ciudad es la palabra anterior. */
const CODIGOS_PAIS = new Set(["MEX"]);

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export interface Regla {
  patron: string;
  categoria: string;
  comercio?: string | null;
}

export interface Aviso {
  id: string;
  fecha: string;
  hora: string;
  tarjeta: string;
  establecimiento: string;
  /** En centavos (entero): nunca float para dinero. */
  centavos: number;
}

/** Fila de `gastos_correo` (sin user_id), lo mismo que sube `sync/gastos_correo.py`. */
export interface FilaGasto {
  mensaje_id: string;
  fecha: string;
  hora: string;
  tarjeta: string;
  comercio: string;
  categoria: string;
  establecimiento: string;
  ciudad_cod: string;
  ciudad: string | null;
  /** Texto con dos decimales: Postgres lo castea a numeric. */
  monto: string;
  moneda: string;
}

// ---------------------------------------------------------------------------
// HTML -> fragmentos de texto (lo que hace HTMLParser con convert_charrefs)
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
// Latin-1 (160-255), que es lo que traen los avisos (&oacute;, &nbsp;, &Ntilde;...).
"nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml"
  .split(" ")
  .forEach((nombre, i) => (ENTIDADES[nombre] = String.fromCharCode(160 + i)));

export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (completo, cuerpo: string) => {
    if (cuerpo[0] === "#") {
      const codigo = cuerpo[1] === "x" || cuerpo[1] === "X" ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : completo;
    }
    return ENTIDADES[cuerpo] ?? ENTIDADES[cuerpo.toLowerCase()] ?? completo;
  });
}

/** Los fragmentos de texto del HTML, en orden, sin entidades y con los
 * espacios colapsados (el aviso rellena con \n, tabs y &nbsp;). */
export function textosDelHtml(html: string): string[] {
  const sinComentarios = html.replace(/<!--[\s\S]*?-->/g, "");
  const textos: string[] = [];
  for (const trozo of sinComentarios.split(/<\/?[a-zA-Z!][^>]*>/)) {
    const limpio = decodificarEntidades(trozo).split(/\s+/).filter(Boolean).join(" ");
    if (limpio) textos.push(limpio);
  }
  return textos;
}

function valorTras(textos: string[], etiqueta: string): string | null {
  for (let i = 0; i < textos.length - 1; i++) if (textos[i] === etiqueta) return textos[i + 1];
  return null;
}

const dos = (n: number) => String(n).padStart(2, "0");

/** (AAAA-MM-DD, HH:MM) en hora CDMX, de los dos formatos reales:
 * "03 Octubre 2026 / 13:22:26" y "2026/10/3 12:01:01 PM". */
export function fechaHora(texto: string): [string, string] | null {
  let m = /^(\d{1,2}) (\w+) (\d{4}) \/ (\d{1,2}):(\d{2}):(\d{2})$/.exec(texto);
  if (m) {
    const mes = MESES[m[2].toLowerCase()];
    if (!mes) return null;
    return [`${m[3].padStart(4, "0")}-${dos(mes)}-${dos(+m[1])}`, `${dos(+m[4])}:${m[5]}`];
  }
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(texto);
  if (m) {
    const hora = (+m[4] % 12) + (m[7] === "PM" ? 12 : 0);
    return [`${m[1]}-${dos(+m[2])}-${dos(+m[3])}`, `${dos(hora)}:${m[5]}`];
  }
  return null;
}

const RETIRO_COMPRA = /Retiro\s*\/\s*Compra/;

function centavosDe(texto: string): number | null {
  const m = /\$\s*([\d,]+\.\d{2})/.exec(texto);
  if (!m) return null;
  const [enteros, decimales] = m[1].replace(/,/g, "").split(".");
  return Number(enteros) * 100 + Number(decimales);
}

/** Aviso "Retiro/Compra con tarjeta ...": null si no es un cargo exitoso que
 * se pueda leer completo (nunca se adivina). */
export function parsearAviso(html: string, mensajeId: string): Aviso | null {
  const textos = textosDelHtml(html);
  if (!textos.some((t) => RETIRO_COMPRA.test(t))) return null;
  if ((valorTras(textos, "Estatus") ?? "").toLowerCase() !== "exitoso") return null;
  const centavos = centavosDe(valorTras(textos, "Monto") ?? "");
  const establecimiento = valorTras(textos, "Establecimiento");
  const fh = fechaHora(valorTras(textos, "Fecha y hora") ?? "");
  let tarjeta: string | null = null;
  for (const t of textos) {
    const m = /Adicional\s+(\d{3,4})\b/i.exec(t) ?? /\*\*(\d{3,4})\b/.exec(t);
    if (m) {
      tarjeta = m[1];
      break;
    }
  }
  if (centavos === null || !establecimiento || !fh || !tarjeta) return null;
  return { id: mensajeId, fecha: fh[0], hora: fh[1], tarjeta, establecimiento, centavos };
}

/** ¿Es un aviso de la cuenta de débito ("Cheques M.N. ***123")? No trae
 * establecimiento y no se suma como gasto (decisión del usuario, 2026-10-06). */
export function esDebito(html: string): boolean {
  const textos = textosDelHtml(html);
  if (!textos.some((t) => RETIRO_COMPRA.test(t))) return false;
  if (!textos.some((t) => /\bM\.N\.\s*\*{3}\d+/.test(t)) || valorTras(textos, "Establecimiento")) return false;
  if ((valorTras(textos, "Estatus") ?? "").toLowerCase() !== "exitoso") return false;
  return centavosDe(valorTras(textos, "Monto") ?? "") !== null && fechaHora(valorTras(textos, "Fecha y hora") ?? "") !== null;
}

// ---------------------------------------------------------------------------
// Categoría, comercio y ciudad (mismas reglas que transform/categorizador.py)
// ---------------------------------------------------------------------------

export function categorizar(descripcion: string, reglas: Regla[]): [string | null, string | null] {
  const d = descripcion.toUpperCase();
  for (const r of reglas) if (d.includes(r.patron.toUpperCase())) return [r.categoria, r.comercio ?? null];
  return [null, null];
}

/** Como `str.title()` de Python: mayúscula al inicio de cada tramo de letras. */
export function titulo(texto: string): string {
  return texto.replace(/\p{L}+/gu, (p) => p[0].toUpperCase() + p.slice(1).toLowerCase());
}

export function ciudadDe(establecimiento: string, extra: Record<string, string> = {}): [string, string | null] {
  const texto = establecimiento.trim();
  const codigo = texto.slice(-3).toUpperCase();
  if (CODIGOS_PAIS.has(codigo)) {
    const palabras = texto.split(/\s+/);
    return [codigo, palabras.length >= 2 ? titulo(palabras[palabras.length - 2]) : null];
  }
  return [codigo, { ...CIUDADES_CONFIRMADAS, ...extra }[codigo] ?? null];
}

function comercioLegible(establecimiento: string): string {
  const e = establecimiento.trim();
  return titulo(e.slice(0, -3).trim()) || titulo(e);
}

/** Lo que dependen de las reglas: se recalcula al cambiar las reglas. */
export function clasificar(
  establecimiento: string,
  reglas: Regla[],
  ciudades: Record<string, string>
): Pick<FilaGasto, "categoria" | "comercio" | "ciudad_cod" | "ciudad"> {
  const [categoria, comercio] = categorizar(establecimiento, reglas);
  const [ciudad_cod, ciudad] = ciudadDe(establecimiento, ciudades);
  return {
    categoria: categoria || "Sin categoría",
    comercio: comercio || comercioLegible(establecimiento),
    ciudad_cod,
    ciudad,
  };
}

export const montoTexto = (centavos: number) => `${Math.floor(centavos / 100)}.${dos(centavos % 100)}`;

export function aFila(aviso: Aviso, reglas: Regla[], ciudades: Record<string, string>): FilaGasto {
  return {
    mensaje_id: aviso.id,
    fecha: aviso.fecha,
    hora: aviso.hora,
    tarjeta: aviso.tarjeta,
    establecimiento: aviso.establecimiento,
    ...clasificar(aviso.establecimiento, reglas, ciudades),
    monto: montoTexto(aviso.centavos),
    moneda: "MXN",
  };
}

/** Reglas guardadas en `preferencias` (las sube la app de escritorio); lo que
 * no tenga patrón y categoría de texto se ignora. */
export function reglasValidas(valor: unknown): Regla[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((r) =>
    r && typeof r.patron === "string" && r.patron && typeof r.categoria === "string" && r.categoria
      ? [{ patron: r.patron, categoria: r.categoria, comercio: typeof r.comercio === "string" ? r.comercio : null }]
      : []
  );
}

export function ciudadesValidas(valor: unknown): Record<string, string> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  return Object.fromEntries(
    Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "string" ? [[k.toUpperCase(), v]] : []))
  );
}

// ---------------------------------------------------------------------------
// Mensaje de la API de Gmail
// ---------------------------------------------------------------------------

interface ParteGmail {
  mimeType?: string;
  body?: { data?: string };
  parts?: ParteGmail[];
}

function base64UrlATexto(datos: string): string {
  const b64 = datos.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (datos.length % 4)) % 4);
  const binario = atob(b64);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/** La parte text/html (a cualquier profundidad), decodificada. */
export function htmlDelMensaje(mensaje: { payload?: ParteGmail }): string | null {
  const buscar = (parte: ParteGmail | undefined): string | null => {
    if (!parte) return null;
    if (parte.mimeType === "text/html" && parte.body?.data) return base64UrlATexto(parte.body.data);
    for (const hija of parte.parts ?? []) {
      const encontrado = buscar(hija);
      if (encontrado) return encontrado;
    }
    return null;
  };
  return buscar(mensaje.payload);
}
