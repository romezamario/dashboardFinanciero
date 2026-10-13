// Envía los correos de cobro (correosCobro.ts) por la API de Resend, el mismo
// proveedor del SMTP de los correos de auth. Es un extra: si falta la
// configuración o Resend falla, se anota en el log y el cobro sigue igual.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Correo } from "./correosCobro.ts";

/** Correo y nombre del cliente (su correo de la app, no el del pagador en MP). */
export async function destinatario(
  admin: SupabaseClient,
  userId: string
): Promise<{ correo: string; nombre: string | null } | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  const correo = data?.user?.email;
  if (!correo) return null;
  const { data: perfil } = await admin.from("perfiles").select("nombre").eq("user_id", userId).maybeSingle();
  return { correo, nombre: (perfil?.nombre as string | null | undefined) ?? null };
}

export async function enviarCorreo(para: string, correo: Correo): Promise<void> {
  const llave = Deno.env.get("RESEND_API_KEY");
  const remitente = Deno.env.get("CORREO_REMITENTE");
  if (!llave || !remitente) {
    console.log("correo", "sin RESEND_API_KEY / CORREO_REMITENTE: no se envía", correo.asunto);
    return;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Ordena tu Lana <${remitente}>`,
        to: [para],
        subject: correo.asunto,
        html: correo.html,
        text: correo.texto,
      }),
    });
    if (!r.ok) console.error("correo", r.status, (await r.text()).slice(0, 300));
  } catch (e) {
    console.error("correo", (e as Error).message);
  }
}
