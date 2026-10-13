// "Cancelar suscripción" en Mi cuenta (y antes de "Borrar mi cuenta"): cancela
// en Mercado Pago todas las suscripciones vivas de quien llama. Ya no habrá
// más cobros; el plan sigue hasta el fin del periodo pagado (periodo_fin, que
// mi_plan() respeta).
import { clienteAdmin, cancelarEnMercadoPago, preflight, responder, usuarioQueLlama } from "../_compartido/servidor.ts";
import { correoPlanCancelado } from "../_compartido/correosCobro.ts";
import { destinatario, enviarCorreo } from "../_compartido/avisarPorCorreo.ts";
import { type Entorno, nombrePlan, type PlanPago, SITIO_DE_ENTORNO } from "../_compartido/mercadopago.ts";

Deno.serve(async (req) => {
  const opciones = preflight(req);
  if (opciones) return opciones;
  if (req.method !== "POST") return responder(req, 405, { error: "Método no permitido" });

  const admin = clienteAdmin();
  const usuario = await usuarioQueLlama(req, admin);
  if (!usuario) return responder(req, 401, { error: "Inicia sesión para cancelar." });

  const { data: vivas, error } = await admin
    .from("suscripciones")
    .select("id, proveedor, proveedor_id, estado, plan_id, periodo, periodo_fin, entorno")
    .eq("user_id", usuario.id)
    .in("estado", ["pendiente", "activa", "pausada"]);
  if (error) return responder(req, 500, { error: error.message });

  let canceladas = 0;
  let ultima: { plan_id: string; periodo: "mensual" | "anual"; periodo_fin: string | null; entorno: Entorno } | null = null;
  for (const s of vivas ?? []) {
    if (s.proveedor !== "mercadopago") continue;
    try {
      await cancelarEnMercadoPago(s.entorno, s.proveedor_id);
    } catch (e) {
      // Una pendiente que nunca se pagó puede no existir ya en Mercado Pago;
      // una activa sin cancelar seguiría cobrando: eso sí es un error.
      if (s.estado !== "pendiente") {
        console.error("cancelar-suscripcion", (e as Error).message);
        return responder(req, 502, { error: (e as Error).message });
      }
    }
    await admin
      .from("suscripciones")
      .update({ estado: "cancelada", actualizado_en: new Date().toISOString() })
      .eq("id", s.id);
    if (s.estado !== "pendiente") {
      canceladas++;
      ultima = s;
    }
  }
  if (ultima) {
    const para = await destinatario(admin, usuario.id);
    if (para) {
      await enviarCorreo(
        para.correo,
        correoPlanCancelado({
          nombre: para.nombre,
          plan: nombrePlan(ultima.plan_id as PlanPago),
          periodo: ultima.periodo,
          hasta: ultima.periodo_fin,
          sitio: SITIO_DE_ENTORNO[ultima.entorno],
        })
      );
    }
  }
  return responder(req, 200, { canceladas });
});
