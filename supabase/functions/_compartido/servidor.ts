// Piezas de servidor comunes a las Edge Functions de cobro (Deno): respuestas
// con CORS, el cliente de Supabase con la llave service_role (la inyecta
// Supabase; nunca sale de ahí), quién llama y las llamadas a Mercado Pago.
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { SITIOS_POR_DEFECTO } from "./mercadopago.ts";

export const API_MP = "https://api.mercadopago.com";

export function sitiosPermitidos(): string[] {
  const propios = (Deno.env.get("SITIOS_PERMITIDOS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return propios.length ? propios : SITIOS_POR_DEFECTO;
}

function cabecerasCors(req: Request): Record<string, string> {
  const origen = req.headers.get("Origin") ?? "";
  // localhost para `npm run dev`; el resto, solo los sitios del producto.
  const permitido = sitiosPermitidos().includes(origen) || /^http:\/\/localhost:\d+$/.test(origen);
  return {
    "Access-Control-Allow-Origin": permitido ? origen : sitiosPermitidos()[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function responder(req: Request, estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cabecerasCors(req), "Content-Type": "application/json" },
  });
}

export const preflight = (req: Request) =>
  req.method === "OPTIONS" ? new Response("ok", { headers: cabecerasCors(req) }) : null;

export function clienteAdmin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** El usuario de la sesión que llama (su JWT en Authorization), o null. */
export async function usuarioQueLlama(req: Request, admin: SupabaseClient): Promise<User | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

export class ErrorMercadoPago extends Error {
  constructor(
    public estado: number,
    mensaje: string
  ) {
    super(mensaje);
  }
}

/** Llamada a la API de Mercado Pago con el Access Token del vendedor (en
 * modo de prueba, el del usuario de prueba vendedor). */
export async function mercadoPago<T = Record<string, unknown>>(
  metodo: "GET" | "POST" | "PUT",
  ruta: string,
  cuerpo?: unknown
): Promise<T> {
  const token = Deno.env.get("MP_ACCESS_TOKEN");
  if (!token) throw new ErrorMercadoPago(503, "Los pagos todavía no están configurados.");
  const respuesta = await fetch(`${API_MP}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(metodo === "POST" ? { "X-Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = { message: texto.slice(0, 300) };
  }
  if (!respuesta.ok) {
    const mensaje = (datos as { message?: string } | null)?.message ?? `HTTP ${respuesta.status}`;
    throw new ErrorMercadoPago(respuesta.status, `Mercado Pago respondió: ${mensaje}`);
  }
  return datos as T;
}

/** Lo que leemos de un preapproval de Mercado Pago. */
export interface Preapproval {
  id: string;
  status: string;
  external_reference?: string | null;
  next_payment_date?: string | null;
  auto_recurring?: { frequency?: number; frequency_type?: string; transaction_amount?: number };
}

export const cancelarEnMercadoPago = (id: string) =>
  mercadoPago<Preapproval>("PUT", `/preapproval/${encodeURIComponent(id)}`, { status: "cancelled" });
