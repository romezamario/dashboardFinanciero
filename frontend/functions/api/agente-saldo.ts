// Cloudflare Pages Function: GET /api/agente-saldo
//
// Saldo de la cuenta simulada del agente de trading, que vive en otro repo
// (romezamario/trading-agent, privado): este tablero solo lo grafica. Se lee
// `output/balance.json` de la rama main con la API de contenidos de GitHub y
// un token de solo lectura en la variable de entorno GITHUB_TOKEN_AGENTE
// (Cloudflare Pages → Settings → Variables). Sin token responde 503 con un
// mensaje que la pestaña muestra tal cual.
//
// En `npm run dev`, vite.config.ts monta este mismo handler como middleware
// (ahí el token se toma de process.env).

export const REPO_AGENTE = "romezamario/trading-agent";
export const RUTA_SALDO = "output/balance.json";
const SEGUNDOS_EN_CACHE = 300;

export interface PuntoSaldo {
  /** YYYY-MM-DD */
  date: string;
  balance: number;
}

/** Posición abierta al último día de la simulación. */
export interface PosicionAgente {
  asset: string;
  /** Fracción de la cuenta (0.3 = 30%). */
  weight: number;
  value_mxn: number;
  entry_date: string | null;
  entry_price_usd: number | null;
  price_usd: number;
  /** Cambio del precio desde la entrada, como fracción. */
  price_change: number | null;
  /** Lo que costó lo que queda de la posición (MXN, comisiones incluidas). */
  cost_basis_mxn?: number | null;
  /** Valor actual − costo, en MXN y como fracción del costo. */
  unrealized_pnl_mxn?: number | null;
  unrealized_pnl_pct?: number | null;
}

/** Orden simulada que ejecutó el agente. */
export interface OrdenAgente {
  date: string;
  asset: string;
  side: "buy" | "sell";
  amount_mxn: number;
  price_usd: number;
  weight_before: number;
  weight_after: number;
  cost_mxn: number;
  /** Solo en ventas: lo recibido − comisión − lo que costó lo vendido (MXN y fracción). */
  pnl_mxn?: number;
  pnl_pct?: number | null;
}

/** Formato de output/balance.json (lo escribe agent/export.py del agente). */
export interface SaldoAgente {
  currency: string;
  source: string;
  strategy: string;
  initial_balance: number;
  current_balance: number;
  goal: number;
  updated_at: string;
  series: PuntoSaldo[];
  /** Solo en versiones del agente que ya las exportan. */
  positions?: PosicionAgente[];
  trades?: OrdenAgente[];
}

interface Entorno {
  GITHUB_TOKEN_AGENTE?: string;
}

export async function obtenerSaldoAgente(token: string): Promise<SaldoAgente> {
  const url = `https://api.github.com/repos/${REPO_AGENTE}/contents/${RUTA_SALDO}?ref=main`;
  const respuesta = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "dashboard-financiero",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (respuesta.status === 404) {
    throw new Error(`Todavía no existe ${RUTA_SALDO} en la rama main de ${REPO_AGENTE}`);
  }
  if (!respuesta.ok) throw new Error(`GitHub respondió ${respuesta.status}`);
  return (await respuesta.json()) as SaldoAgente;
}

export async function onRequestGet({ env }: { request: Request; env?: Entorno }): Promise<Response> {
  const token = env?.GITHUB_TOKEN_AGENTE;
  if (!token) {
    return Response.json(
      { error: "Falta configurar GITHUB_TOKEN_AGENTE en Cloudflare Pages para leer el repo del agente" },
      { status: 503 }
    );
  }
  try {
    const saldo = await obtenerSaldoAgente(token);
    return Response.json(saldo, { headers: { "Cache-Control": `private, max-age=${SEGUNDOS_EN_CACHE}` } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
