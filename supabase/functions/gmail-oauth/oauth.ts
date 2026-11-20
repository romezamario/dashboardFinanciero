// Piezas puras del flujo OAuth de Gmail desde el dashboard (probadas en
// oauth.test.ts). La Edge Function vive en index.ts.

export const ALCANCE_GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
export const MINUTOS_STATE = 15;

/** Sitios a los que se puede volver después de autorizar: el dashboard
 * personal (y las ligas de cada deploy, `<hash>.<proyecto>.pages.dev`) y el
 * servidor de desarrollo. GMAIL_SITIOS_PERMITIDOS agrega orígenes exactos. */
const PROYECTOS_PAGES = ["dashboard-personal-8uu.pages.dev", "dashboard-financiero-c5z.pages.dev"];

export function sitioPermitido(origen: string, extra: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(origen);
  } catch {
    return false;
  }
  if (url.origin !== origen.replace(/\/$/, "")) return false;
  if (extra.includes(url.origin)) return true;
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:") return false;
  return PROYECTOS_PAGES.some((p) => url.hostname === p || url.hostname.endsWith(`.${p}`));
}

/** A dónde volver: el origen del dashboard + `#finanzas` (la pestaña abierta
 * se recuerda en sessionStorage, así que vuelve a "Gastos recientes"). */
export function direccionDeRegreso(origen: string, extra: string[] = []): string | null {
  if (!sitioPermitido(origen, extra)) return null;
  return `${new URL(origen).origin}/`;
}

export function urlAutorizacion(p: { clientId: string; redirect: string; estado: string; correo?: string | null }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirect,
    response_type: "code",
    scope: ALCANCE_GMAIL,
    // offline + consent: Google siempre devuelve un refresh token nuevo.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: p.estado,
  });
  if (p.correo) q.set("login_hint", p.correo);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export type ResultadoOauth = "conectado" | "cancelado" | "sin_permiso" | "error";

/** URL del dashboard con el resultado en `?gmail=` (EstadoGmail lo lee y lo quita). */
export function urlResultado(volver: string, resultado: ResultadoOauth, detalle?: string): string {
  const url = new URL(volver);
  url.searchParams.set("gmail", resultado);
  if (detalle) url.searchParams.set("gmail_detalle", detalle.slice(0, 200));
  url.hash = "finanzas";
  return url.toString();
}

/** state aleatorio de 32 bytes en base64url. */
export function nuevoEstado(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** ¿Google concedió el permiso de lectura? (el usuario puede desmarcarlo). */
export function concedioGmail(alcances: string | undefined): boolean {
  return (alcances ?? "").split(/\s+/).includes(ALCANCE_GMAIL);
}
