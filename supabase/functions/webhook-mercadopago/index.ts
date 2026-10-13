// Avisos de Mercado Pago (Tus integraciones → Webhooks, eventos "Planes y
// suscripciones"). Valida la firma x-signature con MP_WEBHOOK_SECRET y, aun
// así, nunca confía en el aviso: vuelve a consultar la suscripción en la API y
// escribe lo que Mercado Pago dice. Es la única vía por la que una
// suscripción se vuelve activa. Se despliega sin verificación de JWT
// (config.toml): Mercado Pago no trae sesión de Supabase.
import {
  datosDelAviso,
  estadoDesdeMercadoPago,
  firmaValida,
  periodoDesdeFrecuencia,
  planPorMonto,
} from "../_compartido/mercadopago.ts";
import {
  cancelarEnMercadoPago,
  clienteAdmin,
  ErrorMercadoPago,
  mercadoPago,
  type Preapproval,
} from "../_compartido/servidor.ts";

const admin = clienteAdmin();

interface CobroAutorizado {
  preapproval_id: string;
  status?: string;
  debit_date?: string | null;
  date_created?: string | null;
  payment?: { status?: string } | null;
}

async function anotar(aviso: Record<string, unknown>) {
  const { error } = await admin.from("avisos_pago").insert(aviso);
  if (error) console.error("avisos_pago", error.message);
}

/** Cancela (aquí y en Mercado Pago) las otras suscripciones vivas del
 * usuario: al pagar un plan nuevo, el anterior deja de cobrarse. Lo ya pagado
 * de la anterior sigue valiendo hasta su periodo_fin. */
async function cancelarLasDemas(userId: string, idVigente: string) {
  const { data } = await admin
    .from("suscripciones")
    .select("id, proveedor_id, estado")
    .eq("user_id", userId)
    .eq("proveedor", "mercadopago")
    .neq("id", idVigente)
    .in("estado", ["pendiente", "activa", "pausada"]);
  for (const s of data ?? []) {
    try {
      await cancelarEnMercadoPago(s.proveedor_id);
    } catch (e) {
      if (s.estado !== "pendiente") throw e;
    }
    await admin.from("suscripciones").update({ estado: "cancelada", actualizado_en: new Date().toISOString() }).eq("id", s.id);
  }
}

async function procesar(tipo: string, id: string): Promise<string> {
  let preapprovalId: string;
  let cobro: CobroAutorizado | null = null;
  if (tipo === "subscription_preapproval" || tipo === "preapproval") {
    preapprovalId = id;
  } else if (tipo === "subscription_authorized_payment" || tipo === "authorized_payment") {
    cobro = await mercadoPago<CobroAutorizado>("GET", `/authorized_payments/${encodeURIComponent(id)}`);
    preapprovalId = cobro.preapproval_id;
  } else {
    return `tipo ignorado: ${tipo}`;
  }

  const mp = await mercadoPago<Preapproval>("GET", `/preapproval/${encodeURIComponent(preapprovalId)}`);
  const estado = estadoDesdeMercadoPago(mp.status);
  if (!estado) return `estado desconocido: ${mp.status}`;

  const { data: existente } = await admin
    .from("suscripciones")
    .select("id, user_id, periodo_fin")
    .eq("proveedor", "mercadopago")
    .eq("proveedor_id", mp.id)
    .maybeSingle();

  let fila = existente;
  if (!fila) {
    // Sin fila nuestra: solo si external_reference es un usuario que existe.
    const userId = mp.external_reference ?? "";
    const { data: usuario } = /^[0-9a-f-]{36}$/i.test(userId)
      ? await admin.auth.admin.getUserById(userId)
      : { data: { user: null } };
    if (!usuario?.user) {
      // Nadie a quien darle el plan (p. ej. borró su cuenta): que no cobre.
      if (estado === "activa" || estado === "pausada") await cancelarEnMercadoPago(mp.id);
      return "sin usuario: cancelada en Mercado Pago";
    }
    const periodo = periodoDesdeFrecuencia(mp.auto_recurring?.frequency, mp.auto_recurring?.frequency_type);
    const monto = Number(mp.auto_recurring?.transaction_amount);
    const { data: planes } = await admin.from("planes").select("id, precio_mensual, precio_anual");
    const plan = periodo ? planPorMonto(planes ?? [], monto, periodo) : null;
    if (!periodo || !plan) return `no corresponde a ningún plan (${monto} MXN)`;
    const { data: nueva, error } = await admin
      .from("suscripciones")
      .insert({ user_id: userId, plan_id: plan, periodo, monto, estado, proveedor: "mercadopago", proveedor_id: mp.id })
      .select("id, user_id, periodo_fin")
      .single();
    if (error) throw new Error(error.message);
    fila = nueva;
  }

  const cambios: Record<string, unknown> = { estado, actualizado_en: new Date().toISOString() };
  // Mientras cobra, periodo_fin = próximo cobro. Al cancelarse se conserva el
  // último conocido: hasta ahí está pagado.
  if (mp.next_payment_date && (estado === "activa" || !fila.periodo_fin)) cambios.periodo_fin = mp.next_payment_date;
  if (cobro) {
    cambios.ultimo_cobro_en = cobro.debit_date ?? cobro.date_created ?? null;
    cambios.ultimo_cobro_estado = cobro.payment?.status ?? cobro.status ?? null;
  }
  const { error } = await admin.from("suscripciones").update(cambios).eq("id", fila.id);
  if (error) throw new Error(error.message);

  if (estado === "activa") await cancelarLasDemas(fila.user_id, fila.id);
  return `suscripción ${estado}`;
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
