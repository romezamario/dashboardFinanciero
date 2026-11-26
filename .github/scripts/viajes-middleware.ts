// Middleware de /viajes/* (la Bitácora de viajes que se copia de GestionViajes).
// incluir-viajes.sh lo copia a frontend/functions/viajes/_middleware.ts en cada
// deploy; no vive en frontend/functions/viajes/ porque esa carpeta la crea el
// script con el código de GestionViajes.
//
// Por qué (auditoría 2026-11-26): Cloudflare Access deja entrar al dashboard a
// los invitados de «acceso compartido». La tarjeta Viajes está oculta para ellos
// (soloDueno), pero sin este filtro podían abrir /viajes/ o /viajes/api/trips
// directo y ver o cambiar todos los viajes, los documentos (pasaporte) y los
// boletos adjuntos. Ahora solo pasa el dueño.
//
// Correos permitidos: CORREOS_VIAJES (variable de Pages, separados por coma); si
// no está, la misma lista de Trading (CORREOS_TRADING o su valor por defecto).
// Sin el encabezado de Access solo se deja pasar en local: en Internet eso
// significa que Access no está delante, y entonces no se sirve nada.
// /viajes/compartir/* (enlace público de solo lectura, Bypass en Access) queda
// fuera: lo protege su propio código en la URL.
import { CORREOS_TRADING_POR_DEFECTO, puedeUsarTrading } from "../api/_middleware.ts";

interface Entorno {
  CORREOS_VIAJES?: string;
  CORREOS_TRADING?: string;
}

const COMPARTIR = /^\/viajes\/compartir(\/|$)/;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

const prohibido = (texto: string) =>
  new Response(texto, { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function onRequest({
  request,
  env,
  next,
}: {
  request: Request;
  env?: Entorno;
  next: () => Promise<Response>;
}): Promise<Response> {
  const url = new URL(request.url);
  if (COMPARTIR.test(url.pathname)) return next();
  const correo = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (correo === null) return LOCAL.test(url.hostname) ? next() : prohibido("Sin acceso");
  const lista = env?.CORREOS_VIAJES || env?.CORREOS_TRADING || CORREOS_TRADING_POR_DEFECTO;
  if (!puedeUsarTrading(correo, lista)) return prohibido("Tu cuenta no tiene acceso a Viajes.");
  return next();
}
