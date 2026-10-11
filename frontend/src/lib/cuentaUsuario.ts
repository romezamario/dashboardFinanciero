// Lógica sin React del ciclo de vida de la cuenta en FinanzasPersonales
// (fase 1 del plan de suscripciones): rutas públicas, enlaces que manda
// Supabase por correo, mensajes de error en español y validaciones del
// registro. Probado en cuentaUsuario.test.ts.

/** Versión de los términos y del aviso de privacidad que se aceptan al
 * registrarse (se guarda en perfiles.terminos_version). Cámbiala cuando
 * cambie el texto de components/Legal.tsx. */
export const VERSION_TERMINOS = "2026-10-11";

export const LONGITUD_MINIMA_CONTRASENA = 8;

/** Pantallas sin sesión. Sin enrutador: el hash de la URL decide cuál se ve
 * (así el botón Atrás del navegador funciona y no hace falta configurar
 * rutas en Cloudflare Pages). */
export type RutaPublica = "inicio" | "entrar" | "registro" | "recuperar" | "terminos" | "privacidad";

const RUTAS: ReadonlySet<string> = new Set(["entrar", "registro", "recuperar", "terminos", "privacidad"]);

/** Cualquier otro hash (#precios, #preguntas, los tokens que agrega
 * Supabase) es la página de inicio. */
export function rutaDeHash(hash: string): RutaPublica {
  const nombre = hash.replace(/^#/, "");
  return RUTAS.has(nombre) ? (nombre as RutaPublica) : "inicio";
}

export interface EnlaceDeAuth {
  /** El usuario llegó desde "Recuperar contraseña": hay que pedirle la nueva. */
  recuperacion: boolean;
  /** El enlace venció o ya se usó (Supabase lo dice en el hash). */
  error: string | null;
}

/** Lee el hash con el que Supabase regresa al sitio desde un correo
 * (`#access_token=…&type=recovery` o `#error=…&error_code=otp_expired`). Hay
 * que leerlo antes de crear el cliente de Supabase, que lo borra de la URL. */
export function leerEnlaceDeAuth(hash: string): EnlaceDeAuth {
  const parametros = new URLSearchParams(hash.replace(/^#/, ""));
  const recuperacion = parametros.get("type") === "recovery" && parametros.has("access_token");
  if (!parametros.has("error") && !parametros.has("error_code")) return { recuperacion, error: null };
  const codigo = parametros.get("error_code");
  const error =
    codigo === "otp_expired"
      ? "El enlace del correo ya venció o ya se usó. Pide uno nuevo."
      : "No se pudo abrir el enlace del correo. Pide uno nuevo.";
  return { recuperacion: false, error };
}

/** Tipos de enlace que mandan los correos propios (supabase/correos/): el
 * enlace apunta al sitio, no a supabase.co, y el sitio verifica el token. */
export type TipoVerificacion = "email" | "recovery" | "email_change";

const TIPOS_VERIFICACION: ReadonlySet<string> = new Set(["email", "recovery", "email_change"]);

export interface VerificacionPendiente {
  tokenHash: string;
  tipo: TipoVerificacion;
}

/** Lee `?token_hash=…&type=…` (el enlace de los correos de FinanzasPersonales).
 * null si la URL no trae uno válido. */
export function leerVerificacion(busqueda: string): VerificacionPendiente | null {
  const parametros = new URLSearchParams(busqueda);
  const tokenHash = parametros.get("token_hash");
  const tipo = parametros.get("type");
  if (!tokenHash || !tipo || !TIPOS_VERIFICACION.has(tipo)) return null;
  return { tokenHash, tipo: tipo as TipoVerificacion };
}

/** La misma URL sin el token: se quita en cuanto se lee, para que no quede
 * en el historial ni se reintente al recargar. */
export function urlSinVerificacion(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("token_hash");
  u.searchParams.delete("type");
  return u.pathname + u.search + u.hash;
}

/** Mensaje cuando el token del correo ya no sirve. */
export function mensajeVerificacionFallida(tipo: TipoVerificacion): string {
  return tipo === "recovery"
    ? "El enlace para cambiar tu contraseña ya venció o ya se usó. Pide uno nuevo."
    : "El enlace del correo ya venció o ya se usó. Si ya confirmaste tu correo, solo entra.";
}

/** Los errores de Supabase Auth llegan en inglés; estos son los que un
 * usuario puede provocar al entrar, registrarse o cambiar su contraseña. */
export function traducirErrorAuth(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (m.includes("email not confirmed"))
    return "Todavía no confirmas tu correo. Abre el enlace que te mandamos o pide otro.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "Ya existe una cuenta con ese correo. Entra o recupera tu contraseña.";
  if (m.includes("should be different")) return "La contraseña nueva tiene que ser distinta de la actual.";
  if (m.includes("password should be") || m.includes("weak password"))
    return `La contraseña es muy débil: usa al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres, con letras y números.`;
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes"))
    return "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentar.";
  if (m.includes("invalid email") || m.includes("unable to validate email"))
    return "Ese correo no parece válido.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled"))
    return "El registro está cerrado por ahora.";
  if (m.includes("failed to fetch") || m.includes("network"))
    return "No hay conexión con el servidor. Revisa tu internet.";
  return mensaje;
}

/** null = la contraseña sirve. Supabase revisa lo mismo del lado del
 * servidor; esto solo evita el viaje y da el mensaje en español. */
export function problemaDeContrasena(contrasena: string, confirmacion: string): string | null {
  if (contrasena.length < LONGITUD_MINIMA_CONTRASENA)
    return `La contraseña necesita al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres.`;
  if (!/[a-zA-Z]/.test(contrasena) || !/\d/.test(contrasena))
    return "La contraseña necesita letras y números.";
  if (contrasena !== confirmacion) return "Las dos contraseñas no coinciden.";
  return null;
}

/** La palabra que hay que escribir para confirmar el borrado de la cuenta. */
export const PALABRA_BORRAR = "BORRAR";

export function confirmaBorrado(texto: string): boolean {
  return texto.trim().toUpperCase() === PALABRA_BORRAR;
}
