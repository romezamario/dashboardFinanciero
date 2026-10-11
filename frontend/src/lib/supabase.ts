import { createClient } from "@supabase/supabase-js";
import { leerEnlaceDeAuth, leerVerificacion, urlSinVerificacion } from "./cuentaUsuario";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — revisa frontend/.env (local) o los secrets de GitHub Actions (deploy)."
  );
}

/** Con qué enlace de correo se abrió el sitio (recuperar contraseña, o uno
 * vencido). Se lee ANTES de crear el cliente: él borra ese hash de la URL, y
 * el evento PASSWORD_RECOVERY puede emitirse antes de que React se suscriba. */
export const ENLACE_INICIAL = leerEnlaceDeAuth(
  typeof window === "undefined" ? "" : window.location.hash
);

/** El enlace de un correo propio de FinanzasPersonales (`?token_hash=…&type=…`,
 * plantillas en supabase/correos/). Se quita de la URL al leerlo; App lo
 * verifica con verifyOtp. */
export const VERIFICACION_INICIAL =
  typeof window === "undefined" ? null : leerVerificacion(window.location.search);
if (VERIFICACION_INICIAL)
  window.history.replaceState(null, "", urlSinVerificacion(window.location.href));

export const supabase = createClient(url, anonKey);
