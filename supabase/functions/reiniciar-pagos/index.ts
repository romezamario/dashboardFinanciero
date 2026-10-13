// "Reiniciar pagos" en Administración (pedido del dueño, 2026-10-13, para
// probar el flujo de cobro desde cero): cancela en Mercado Pago las
// suscripciones vivas de QUIEN LLAMA y borra sus filas de `suscripciones`, así
// Mi cuenta vuelve a mostrar la prueba gratis (o Gratis) como un cliente
// nuevo. Solo borra las de PRUEBA (las pagadas con dinero real en
// ordenatulana.com nunca). Solo para administradores (mismo criterio que es_administrador():
// correo confirmado y registrado en `administradores`). No toca a nadie más.
import { clienteAdmin, cancelarEnMercadoPago, esAdministrador, preflight, responder, usuarioQueLlama } from "../_compartido/servidor.ts";

Deno.serve(async (req) => {
  const opciones = preflight(req);
  if (opciones) return opciones;
  if (req.method !== "POST") return responder(req, 405, { error: "Método no permitido" });

  const admin = clienteAdmin();
  const usuario = await usuarioQueLlama(req, admin);
  if (!usuario) return responder(req, 401, { error: "Inicia sesión." });

  if (!(await esAdministrador(admin, usuario))) return responder(req, 403, { error: "Solo un administrador puede reiniciar sus pagos." });

  const { data: filas, error } = await admin
    .from("suscripciones")
    .select("id, proveedor, proveedor_id, estado")
    .eq("user_id", usuario.id)
    .eq("entorno", "prueba");
  if (error) return responder(req, 500, { error: error.message });

  // Primero que deje de cobrar: una viva que no se pudo cancelar en Mercado
  // Pago no se borra (seguiría cobrando sin que la app lo sepa).
  for (const s of filas ?? []) {
    if (s.proveedor !== "mercadopago" || !["activa", "pausada", "pendiente"].includes(s.estado)) continue;
    try {
      await cancelarEnMercadoPago("prueba", s.proveedor_id);
    } catch (e) {
      if (s.estado !== "pendiente") {
        console.error("reiniciar-pagos", (e as Error).message);
        return responder(req, 502, { error: `No se pudo cancelar en Mercado Pago: ${(e as Error).message}` });
      }
    }
  }

  const { error: errorBorrar } = await admin
    .from("suscripciones")
    .delete()
    .eq("user_id", usuario.id)
    .eq("entorno", "prueba");
  if (errorBorrar) return responder(req, 500, { error: errorBorrar.message });
  return responder(req, 200, { borradas: filas?.length ?? 0 });
});
