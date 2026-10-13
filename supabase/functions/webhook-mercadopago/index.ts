// Avisos de Mercado Pago (Tus integraciones → Webhooks, eventos "Planes y
// suscripciones"). Valida la firma x-signature con MP_WEBHOOK_SECRET y, aun
// así, nunca confía en el aviso: vuelve a consultar la suscripción en la API y
// escribe lo que Mercado Pago dice. Es la única vía por la que una
// suscripción se vuelve activa. Se despliega sin verificación de JWT
// (config.toml): Mercado Pago no trae sesión de Supabase.
import { datosDelAviso, firmaValida } from "../_compartido/mercadopago.ts";
import { clienteAdmin, ErrorMercadoPago, mercadoPago } from "../_compartido/servidor.ts";
import { type CobroAutorizado, sincronizarPreapproval } from "../_compartido/sincronizar.ts";

const admin = clienteAdmin();

async function anotar(aviso: Record<string, unknown>) {
  const { error } = await admin.from("avisos_pago").insert(aviso);
  if (error) console.error("avisos_pago", error.message);
}

async function procesar(tipo: string, id: string): Promise<string> {
  if (tipo === "subscription_preapproval" || tipo === "preapproval") return sincronizarPreapproval(id);
  if (tipo === "subscription_authorized_payment" || tipo === "authorized_payment") {
    const cobro = await mercadoPago<CobroAutorizado>("GET", `/authorized_payments/${encodeURIComponent(id)}`);
    return sincronizarPreapproval(cobro.preapproval_id, cobro);
  }
  return `tipo ignorado: ${tipo}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const url = new URL(req.url);
  const cuerpo = await req.json().catch(() => null);
  const aviso = datosDelAviso(url, cuerpo);
  const requestId = req.headers.get("x-request-id");
  const valida = await firmaValida({
    cabeceraFirma: req.headers.get("x-signature"),
    requestId,
    dataId: url.searchParams.get("data.id") ?? aviso?.id ?? null,
    secreto: Deno.env.get("MP_WEBHOOK_SECRET") ?? "",
  });
  const registro = { tipo: aviso?.tipo ?? null, recurso_id: aviso?.id ?? null, request_id: requestId, firma_valida: valida };

  if (!valida) {
    await anotar({ ...registro, resultado: "firma no válida" });
    return new Response("firma no válida", { status: 401 });
  }
  if (!aviso) {
    await anotar({ ...registro, resultado: "aviso sin tipo o id" });
    return new Response("ok");
  }
  try {
    const resultado = await procesar(aviso.tipo, aviso.id);
    await anotar({ ...registro, resultado });
    return new Response("ok");
  } catch (e) {
    // Un recurso que Mercado Pago no conoce (p. ej. el aviso de ejemplo de su
    // panel) no se arregla reintentando.
    if (e instanceof ErrorMercadoPago && e.estado === 404) {
      await anotar({ ...registro, resultado: "recurso no encontrado en Mercado Pago" });
      return new Response("ok");
    }
    // 500 → Mercado Pago reintenta el aviso más tarde.
    console.error("webhook-mercadopago", (e as Error).message);
    await anotar({ ...registro, resultado: `error: ${(e as Error).message}`.slice(0, 500) });
    return new Response("error", { status: 500 });
  }
});
