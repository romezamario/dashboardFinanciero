/**
 * Reintento ante un 401 por token vencido (2026-11-08, logs de Supabase de Mario:
 * GET documentos/eventos/categorias/transacciones y POST soy_invitado con 401 a la
 * vez). Con la llave anónima esas tablas responden 200 (RLS deja 0 filas), así que
 * un 401 ahí significa que se mandó un token de usuario que el servidor ya no
 * acepta — típicamente vencido según el reloj del servidor aunque el del navegador
 * diga que no (equipo que vuelve de suspensión, reloj desfasado), o firmado con una
 * llave que ya no vale. supabase-js solo renueva cuando SU reloj dice que venció,
 * así que en esos casos nunca renovaba y el Dashboard se quedaba en error.
 *
 * Este fetch envuelve las llamadas a la API de datos y funciones: ante un 401
 * renueva la sesión (una sola renovación compartida por las llamadas que fallen a
 * la vez) y repite la llamada UNA vez con el token nuevo. Si no se pudo renovar,
 * `alFallar` cierra la sesión local para que se vea el login, no un error.
 */

type Fetch = typeof fetch;

/** Renueva la sesión: el token nuevo, o null si la sesión ya no sirve. Lanza
 * si la renovación falló por red (no hay que cerrar la sesión por eso). */
export type Renovar = () => Promise<string | null>;

const RUTAS_CON_REINTENTO = ["/rest/v1/", "/functions/v1/"];

function urlDe(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function crearFetchConReintento(
  fetchBase: Fetch,
  renovar: Renovar,
  alFallar: () => void
): Fetch {
  let enCurso: Promise<string | null> | null = null;
  const renovarUnaVez = () => {
    enCurso ??= renovar().finally(() => {
      enCurso = null;
    });
    return enCurso;
  };

  return async (input, init) => {
    const respuesta = await fetchBase(input, init);
    if (respuesta.status !== 401) return respuesta;
    if (!RUTAS_CON_REINTENTO.some((ruta) => urlDe(input).includes(ruta))) return respuesta;
    // Sin token de usuario (solo la llave anónima) no hay nada que renovar.
    const encabezados = new Headers(init?.headers);
    const autorizacion = encabezados.get("Authorization") ?? "";
    const llave = encabezados.get("apikey");
    if (!autorizacion.startsWith("Bearer ") || autorizacion === `Bearer ${llave}`) return respuesta;
    // Un Request con cuerpo ya consumido no se puede repetir.
    if (typeof input !== "string" && !(input instanceof URL) && input.bodyUsed) return respuesta;

    let token: string | null;
    try {
      token = await renovarUnaVez();
    } catch {
      return respuesta;
    }
    if (!token) {
      alFallar();
      return respuesta;
    }
    encabezados.set("Authorization", `Bearer ${token}`);
    return fetchBase(input, { ...init, headers: encabezados });
  };
}
