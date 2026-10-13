// El regreso de Mercado Pago al sitio. Aparte de suscripcion.ts porque
// supabase.ts lo lee al cargar (antes de crear el cliente), igual que los
// enlaces de los correos, y suscripcion.ts importa a supabase.ts.

/** Mercado Pago regresa a `/?pago=mercadopago&preapproval_id=…`
 * (supabase/functions/_compartido/mercadopago.ts, urlDeRegreso). */
export function leerRegresoDePago(busqueda: string): { preapprovalId: string | null } | null {
  const p = new URLSearchParams(busqueda);
  if (p.get("pago") !== "mercadopago") return null;
  return { preapprovalId: p.get("preapproval_id") };
}

/** La misma dirección sin los parámetros del regreso de Mercado Pago. */
export function urlSinRegresoDePago(href: string): string {
  const url = new URL(href);
  for (const clave of ["pago", "preapproval_id"]) url.searchParams.delete(clave);
  return url.pathname + url.search + url.hash;
}
