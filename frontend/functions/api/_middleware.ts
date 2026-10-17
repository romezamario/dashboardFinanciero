// Cloudflare Pages middleware: corre antes de cada Function de /api.
//
// Todo /api es de la pestaña Trading (cotizaciones de Yahoo, saldo del agente,
// cuenta de Alpaca), que solo ve el dueño: un invitado (acceso compartido,
// supabase/migrations/20261017170000_acceso_compartido.sql) tiene las demás
// pestañas pero no esta. El frontend ya la oculta; esto evita que la abra
// pidiendo la URL directo.
//
// Quién llama lo dice Cloudflare Access, que va delante del sitio y agrega el
// encabezado Cf-Access-Authenticated-User-Email (el navegador no lo puede
// falsificar: Access lo pone). Solo pasan los correos de CORREOS_TRADING
// (variable de Pages, separados por coma); sin ella, solo el dueño. Sin el
// encabezado (`npm run dev`, que monta los handlers sin este middleware, o un
// despliegue sin Access) no se bloquea nada: igual que antes.

export const CORREOS_TRADING_POR_DEFECTO = "romezamario@gmail.com";

interface Entorno {
  CORREOS_TRADING?: string;
}

/** ¿Puede este correo (el que reporta Access, o null sin Access) usar /api? */
export function puedeUsarTrading(correo: string | null, permitidos = CORREOS_TRADING_POR_DEFECTO): boolean {
  if (correo === null) return true;
  const lista = permitidos
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  return lista.includes(correo.trim().toLowerCase());
}

export async function onRequest({
  request,
  env,
  next,
}: {
  request: Request;
  env?: Entorno;
  next: () => Promise<Response>;
}): Promise<Response> {
  const correo = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!puedeUsarTrading(correo, env?.CORREOS_TRADING || CORREOS_TRADING_POR_DEFECTO)) {
    return Response.json({ error: "Tu cuenta no tiene acceso a Trading." }, { status: 403 });
  }
  return next();
}
