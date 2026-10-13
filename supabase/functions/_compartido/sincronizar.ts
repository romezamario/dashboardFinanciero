// Sincroniza una suscripción con lo que dice Mercado Pago. Compartido por el
// webhook (cuando MP avisa) y por verificar-suscripcion (cuando el cliente
// abre Mi cuenta), para que el plan se active aunque el aviso no llegue.
import { estadoDesdeMercadoPago, periodoDesdeFrecuencia, planPorMonto } from "./mercadopago.ts";
import { cancelarEnMercadoPago, clienteAdmin, mercadoPago, type Preapproval } from "./servidor.ts";

const admin = clienteAdmin();

export interface CobroAutorizado {
  preapproval_id: string;
  status?: string;
  debit_date?: string | null;
  date_created?: string | null;
  payment?: { status?: string } | null;
}

/** Cancela (aquí y en Mercado Pago) las otras suscripciones vivas del
 * usuario: al pagar un plan nuevo, el anterior deja de cobrarse. Lo ya pagado
 * de la anterior sigue valiendo hasta su periodo_fin. */
export async function cancelarLasDemas(userId: string, idVigente: string) {
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

/** Lee la suscripción en Mercado Pago y escribe en `suscripciones` lo que
 * dice (estado, próximo cobro, último cobro). La usan el webhook y
 * verificar-suscripcion; nunca se confía en lo que trae el aviso. */
export async function sincronizarPreapproval(preapprovalId: string, cobro: CobroAutorizado | null = null): Promise<string> {
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
