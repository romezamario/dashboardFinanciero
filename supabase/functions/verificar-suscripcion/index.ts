// Mi cuenta llama a esta función al abrirse si hay una suscripción pendiente:
// consulta en Mercado Pago las suscripciones pendientes recientes de quien
// llama y las sincroniza. Así el plan se activa aunque el aviso del webhook
// tarde o no llegue. Solo toca filas del propio usuario.
import { clienteAdmin, ErrorMercadoPago, preflight, responder, usuarioQueLlama } from "../_compartido/servidor.ts";
import { sincronizarPreapproval } from "../_compartido/sincronizar.ts";

// Una suscripción que no se pagó en una semana ya no se vuelve a consultar.
const DIAS_PENDIENTE = 7;

Deno.serve(async (req) => {
  const opciones = preflight(req);
  if (opciones) return opciones;
  if (req.method !== "POST") return responder(req, 405, { error: "Método no permitido" });

  const admin = clienteAdmin();
  const usuario = await usuarioQueLlama(req, admin);
  if (!usuario) return responder(req, 401, { error: "Inicia sesión." });

  const desde = new Date(Date.now() - DIAS_PENDIENTE * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("suscripciones")
    .select("proveedor_id")
    .eq("user_id", usuario.id)
    .eq("proveedor", "mercadopago")
    .eq("estado", "pendiente")
    .gte("creado_en", desde);
  if (error) return responder(req, 500, { error: error.message });

  const resultados: string[] = [];
  for (const s of data ?? []) {
    try {
      resultados.push(await sincronizarPreapproval(s.proveedor_id));
    } catch (e) {
      if (e instanceof ErrorMercadoPago && e.estado === 404) continue;
      console.error("verificar-suscripcion", (e as Error).message);
      return responder(req, 502, { error: "No se pudo consultar Mercado Pago." });
    }
  }
  return responder(req, 200, { resultados });
});
