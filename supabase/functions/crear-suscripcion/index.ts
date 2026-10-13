// "Suscribirme" en Mi cuenta. Con `tokenTarjeta` (formulario de tarjeta
// embebido) crea la suscripción ya autorizada y la sincroniza al momento; sin
// él, la crea pendiente y devuelve la dirección de Mercado Pago donde se
// autoriza. El precio sale de la tabla `planes`, nunca del navegador; el estado
// siempre se lee de vuelta de Mercado Pago (sincronizarPreapproval).
import { cuerpoPreapproval, entornoDeOrigen, esPeriodo, esPlanPago, urlDeRegreso } from "../_compartido/mercadopago.ts";
import {
  clienteAdmin,
  ErrorMercadoPago,
  esAdministrador,
  mercadoPago,
  preflight,
  responder,
  sitiosPermitidos,
  usuarioQueLlama,
} from "../_compartido/servidor.ts";
import { sincronizarPreapproval } from "../_compartido/sincronizar.ts";

Deno.serve(async (req) => {
  const opciones = preflight(req);
  if (opciones) return opciones;
  if (req.method !== "POST") return responder(req, 405, { error: "Método no permitido" });

  const admin = clienteAdmin();
  const usuario = await usuarioQueLlama(req, admin);
  if (!usuario?.email) return responder(req, 401, { error: "Inicia sesión para suscribirte." });

  const { plan, periodo, origen, tokenTarjeta } = await req.json().catch(() => ({}));
  if (!esPlanPago(plan) || !esPeriodo(periodo)) return responder(req, 400, { error: "Plan o periodo no válido." });

  // El sitio desde el que se paga decide las credenciales (Origin lo pone el
  // navegador). En pruebas se paga con tarjetas de prueba, que son públicas:
  // como la base es la misma que la de producción, ese plan valdría también en
  // ordenatulana.com, así que en pruebas solo pagan los administradores.
  const entorno = entornoDeOrigen(req.headers.get("Origin"));
  if (entorno === "prueba" && !(await esAdministrador(admin, usuario))) {
    return responder(req, 403, { error: "En el sitio de pruebas solo los administradores pueden hacer pagos de prueba." });
  }

  const { data: vigente } = await admin
    .from("suscripciones")
    .select("id")
    .eq("user_id", usuario.id)
    .eq("plan_id", plan)
    .eq("periodo", periodo)
    .eq("estado", "activa")
    .limit(1);
  if (vigente?.length) return responder(req, 409, { error: "Ya tienes ese plan." });

  const { data: fila, error: errorPlan } = await admin
    .from("planes")
    .select("precio_mensual, precio_anual")
    .eq("id", plan)
    .single();
  if (errorPlan || !fila) return responder(req, 500, { error: "No se encontró el plan." });
  const monto = Number(periodo === "anual" ? fila.precio_anual : fila.precio_mensual);

  try {
    // Con credenciales de prueba, quien paga tiene que ser un comprador de
    // prueba de Mercado Pago, no el correo real del cliente.
    const correo = (entorno === "prueba" && Deno.env.get("MP_CORREO_COMPRADOR_PRUEBA")) || usuario.email;
    const preapproval = await mercadoPago<{ id: string; init_point: string }>(
      entorno,
      "POST",
      "/preapproval",
      cuerpoPreapproval({
        plan,
        periodo,
        monto,
        userId: usuario.id,
        correo,
        urlRegreso: urlDeRegreso(typeof origen === "string" ? origen : null, sitiosPermitidos()),
        tokenTarjeta: typeof tokenTarjeta === "string" && tokenTarjeta ? tokenTarjeta : null,
      })
    );
    const { error } = await admin.from("suscripciones").insert({
      user_id: usuario.id,
      plan_id: plan,
      periodo,
      monto,
      estado: "pendiente",
      proveedor: "mercadopago",
      proveedor_id: preapproval.id,
      entorno,
    });
    if (error) throw new Error(error.message);
    if (tokenTarjeta) {
      const resultado = await sincronizarPreapproval(preapproval.id, entorno);
      return responder(req, 200, { resultado });
    }
    return responder(req, 200, { url: preapproval.init_point });
  } catch (e) {
    const estado = e instanceof ErrorMercadoPago ? (e.estado === 503 ? 503 : 502) : 500;
    console.error("crear-suscripcion", (e as Error).message);
    return responder(req, estado, { error: (e as Error).message });
  }
});
