// Lo que las Edge Functions de cobro necesitan saber de Mercado Pago, sin red
// ni Deno: así lo prueba Vitest (frontend/vitest.config.ts incluye este
// directorio). La API es la de Suscripciones sin plan asociado (/preapproval):
// cada alta lleva el user_id como external_reference y regresa un init_point
// al que se manda al cliente. La prueba de 14 días es nuestra (mi_plan() en la
// base, sin tarjeta), no de Mercado Pago.

export type PlanPago = "basico" | "pro";
export type Periodo = "mensual" | "anual";
export type EstadoSuscripcion = "pendiente" | "activa" | "pausada" | "cancelada";

export const esPlanPago = (x: unknown): x is PlanPago => x === "basico" || x === "pro";
export const esPeriodo = (x: unknown): x is Periodo => x === "mensual" || x === "anual";

/** Estado de un preapproval de Mercado Pago → el nuestro (null = desconocido). */
export function estadoDesdeMercadoPago(status: string | null | undefined): EstadoSuscripcion | null {
  switch (status) {
    case "pending":
      return "pendiente";
    case "authorized":
      return "activa";
    case "paused":
      return "pausada";
    case "cancelled":
    case "canceled":
      return "cancelada";
    default:
      return null;
  }
}

/** Cada cuántos meses se cobra cada periodo. */
export const MESES_POR_PERIODO: Record<Periodo, number> = { mensual: 1, anual: 12 };

export function periodoDesdeFrecuencia(frecuencia: number | undefined, tipo: string | undefined): Periodo | null {
  if (tipo !== "months") return null;
  if (frecuencia === 1) return "mensual";
  if (frecuencia === 12) return "anual";
  return null;
}

/** Qué plan corresponde a un cobro de Mercado Pago, por monto y periodo, para
 * una suscripción que el webhook ve sin fila nuestra (no debería pasar). */
export function planPorMonto(
  planes: { id: string; precio_mensual: number; precio_anual: number }[],
  monto: number,
  periodo: Periodo
): PlanPago | null {
  const plan = planes.find(
    (p) => esPlanPago(p.id) && Number(periodo === "anual" ? p.precio_anual : p.precio_mensual) === monto
  );
  return plan ? (plan.id as PlanPago) : null;
}

/** Sitios a los que Mercado Pago puede regresar al cliente. Pruebas y
 * producción usan la misma base, así que el regreso sigue al sitio de origen,
 * pero solo si es uno de estos (nada de redirecciones abiertas). */
export const SITIOS_POR_DEFECTO = [
  "https://ordenatulana.com",
  "https://www.ordenatulana.com",
  "https://ordenatulana.pages.dev",
  "https://pruebas.ordenatulana.pages.dev",
];

/** Parámetro con el que el sitio reconoce que viene de pagar
 * (frontend/src/lib/suscripcion.ts lo lee). Mercado Pago agrega
 * `&preapproval_id=…` a la dirección de regreso. */
export const PARAMETRO_REGRESO = "pago";

export function urlDeRegreso(origen: string | null | undefined, permitidos: string[]): string {
  const sitio = origen && permitidos.includes(origen) ? origen : permitidos[0];
  return `${sitio}/?${PARAMETRO_REGRESO}=mercadopago`;
}

export const nombrePlan = (plan: PlanPago) => (plan === "pro" ? "Pro" : "Básico");

/** Cuerpo de POST /preapproval: suscripción pendiente que el cliente autoriza
 * en el init_point de Mercado Pago. */
export function cuerpoPreapproval(datos: {
  plan: PlanPago;
  periodo: Periodo;
  monto: number;
  userId: string;
  correo: string;
  urlRegreso: string;
}) {
  return {
    reason: `Ordena tu Lana · Plan ${nombrePlan(datos.plan)} ${datos.periodo}`,
    external_reference: datos.userId,
    payer_email: datos.correo,
    auto_recurring: {
      frequency: MESES_POR_PERIODO[datos.periodo],
      frequency_type: "months",
      transaction_amount: datos.monto,
      currency_id: "MXN",
    },
    back_url: datos.urlRegreso,
    status: "pending",
  };
}

/** Tipo e id del recurso de un aviso. Mercado Pago los manda en la dirección
 * (`?type=…&data.id=…`) y en el cuerpo (`{type, data: {id}}`); los avisos
 * viejos (IPN) usan `topic` e `id`. */
export function datosDelAviso(url: URL, cuerpo: unknown): { tipo: string; id: string } | null {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as {
    type?: unknown;
    topic?: unknown;
    data?: { id?: unknown };
  };
  const tipo = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? c.type ?? c.topic;
  const id = url.searchParams.get("data.id") ?? c.data?.id ?? url.searchParams.get("id");
  if (typeof tipo !== "string" || (typeof id !== "string" && typeof id !== "number")) return null;
  return { tipo, id: String(id) };
}

/** `x-signature: ts=…,v1=…` → sus partes. */
export function leerFirma(cabecera: string | null): { ts: string; v1: string } | null {
  if (!cabecera) return null;
  const partes = new Map(
    cabecera.split(",").map((p) => {
      const [k, ...v] = p.split("=");
      return [k.trim(), v.join("=").trim()] as const;
    })
  );
  const ts = partes.get("ts");
  const v1 = partes.get("v1");
  return ts && v1 ? { ts, v1 } : null;
}

/** El texto que Mercado Pago firma: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * (el id en minúsculas; se omite lo que no venga). */
export function manifiestoFirma(dataId: string | null, requestId: string | null, ts: string): string {
  let m = "";
  if (dataId) m += `id:${dataId.toLowerCase()};`;
  if (requestId) m += `request-id:${requestId};`;
  return m + `ts:${ts};`;
}

export async function hmacSha256Hex(secreto: string, mensaje: string): Promise<string> {
  const codificar = new TextEncoder();
  const llave = await crypto.subtle.importKey(
    "raw",
    codificar.encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const firma = await crypto.subtle.sign("HMAC", llave, codificar.encode(mensaje));
  return Array.from(new Uint8Array(firma), (b) => b.toString(16).padStart(2, "0")).join("");
}

function igualesEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

/** ¿El aviso viene de Mercado Pago? Aun así el webhook nunca confía en su
 * contenido: vuelve a consultar el recurso en la API. */
export async function firmaValida(datos: {
  cabeceraFirma: string | null;
  requestId: string | null;
  dataId: string | null;
  secreto: string;
}): Promise<boolean> {
  const firma = leerFirma(datos.cabeceraFirma);
  if (!firma || !datos.secreto) return false;
  const esperada = await hmacSha256Hex(datos.secreto, manifiestoFirma(datos.dataId, datos.requestId, firma.ts));
  return igualesEnTiempoConstante(esperada, firma.v1.toLowerCase());
}
