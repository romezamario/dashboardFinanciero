// Avisos de Mercado Pago (Tus integraciones → Webhooks, eventos "Planes y
// suscripciones"). Mercado Pago configura una URL por modo: la de producción
// es la URL tal cual y la de prueba lleva `?entorno=prueba`, para consultar
// con las credenciales de ese modo. Valida la firma x-signature con
// MP_WEBHOOK_SECRET_PRODUCCION o MP_WEBHOOK_SECRET (cualquiera) y, aun
// así, nunca confía en el aviso: vuelve a consultar la suscripción en la API y
// escribe lo que Mercado Pago dice. Es la única vía por la que una
// suscripción se vuelve activa. Se despliega sin verificación de JWT
// (config.toml): Mercado Pago no trae sesión de Supabase.
import { datosDelAviso, type Entorno, firmaValida } from "../_compartido/mercadopago.ts";
import { clienteAdmin, ErrorMercadoPago, mercadoPago } from "../_compartido/servidor.ts";
import { type CobroAutorizado, sincronizarPreapproval } from "../_compartido/sincronizar.ts";

const admin = clienteAdmin();

async function anotar(aviso: Record<string, unknown>) {
  const { error } = await admin.from("avisos_pago").insert(aviso);
  if (error) console.error("avisos_pago", error.message);
}

async function procesar(entorno: Entorno, tipo: string, id: string): Promise<string> {
  if (tipo === "subscription_preapproval" || tipo === "preapproval") return sincronizarPreapproval(id, entorno);
  if (tipo === "subscription_authorized_payment" || tipo === "authorized_payment") {
    const cobro = await mercadoPago<CobroAutorizado>(entorno, "GET", `/authorized_payments/${encodeURIComponent(id)}`);
    return sincronizarPreapproval(cobro.preapproval_id, entorno, cobro);
  }
  return `tipo ignorado: ${tipo}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const url = new URL(req.url);
  const entorno: Entorno = url.searchParams.get("entorno") === "prueba" ? "prueba" : "produccion";
  // Mercado Pago puede firmar los dos modos con la misma clave (al regenerarla
  // en un modo cambia la del otro), así que se acepta cualquiera de las dos
  // claves propias, empezando por la del entorno del aviso.
  const prueba = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";
  const produccion = Deno.env.get("MP_WEBHOOK_SECRET_PRODUCCION") ?? "";
  const secretos = (entorno === "produccion" ? [produccion, prueba] : [prueba, produccion]).filter(Boolean);
  const cuerpo = await req.json().catch(() => null);
  const aviso = datosDelAviso(url, cuerpo);
  const requestId = req.headers.get("x-request-id");
  let valida = false;
  for (const secreto of secretos) {
    valida = await firmaValida({
      cabeceraFirma: req.headers.get("x-signature"),
      requestId,
      dataId: url.searchParams.get("data.id") ?? aviso?.id ?? null,
      secreto,
    });
    if (valida) break;
  }
  const registro = { tipo: aviso?.tipo ? `${aviso.tipo} (${entorno})` : null, recurso_id: aviso?.id ?? null, request_id: requestId, firma_valida: valida };

  if (!valida) {
    await anotar({ ...registro, resultado: "firma no válida" });
    return new Response("firma no válida", { status: 401 });
  }
  if (!aviso) {
    await anotar({ ...registro, resultado: "aviso sin tipo o id" });
    return new Response("ok");
  }
  try {
    const resultado = await procesar(entorno, aviso.tipo, aviso.id);
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
