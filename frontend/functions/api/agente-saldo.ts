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
export const RUTA_ALPACA = "output/alpaca.json";
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

/** Posición en la cuenta de prueba de Alpaca (montos en USD). */
export interface PosicionAlpaca {
  symbol: string;
  asset_class: string | null;
  qty: number | null;
  avg_entry_price: number | null;
  current_price: number | null;
  market_value: number | null;
  cost_basis: number | null;
  unrealized_pl: number | null;
  /** Como fracción del costo. */
  unrealized_plpc: number | null;
}

/** Orden en Alpaca con su estado real (filled, accepted, canceled…). */
export interface OrdenAlpaca {
  submitted_at: string | null;
  filled_at: string | null;
  symbol: string;
  side: "buy" | "sell";
  notional: number | null;
  qty: number | null;
  filled_qty: number | null;
  filled_avg_price: number | null;
  status: string | null;
}

/** Formato de output/alpaca.json (la foto de la cuenta de prueba que escribe agent/broker.py). */
export interface CuentaAlpaca {
  broker: string;
  actualizado: string;
  moneda: string;
  equity: number | null;
  /** Valor al cierre del día hábil anterior. */
  last_equity: number | null;
  cash: number | null;
  posiciones: PosicionAlpaca[];
  ordenes: OrdenAlpaca[];
  /** Valor de la cuenta al cierre de cada día (y hoy); en versiones anteriores no viene. */
  historial?: { date: string; equity: number }[];
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
  /** La cuenta de prueba en Alpaca, si el agente ya la tiene (output/alpaca.json). */
  alpaca?: CuentaAlpaca;
}

interface Entorno {
  GITHUB_TOKEN_AGENTE?: string;
}

async function leerArchivo(token: string, ruta: string): Promise<Response> {
  const url = `https://api.github.com/repos/${REPO_AGENTE}/contents/${ruta}?ref=main`;
  return fetch(url, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "dashboard-financiero",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

/** Lee la cuenta de Alpaca; si no existe o falla, la sección simplemente no se muestra. */
async function obtenerCuentaAlpaca(token: string): Promise<CuentaAlpaca | undefined> {
  try {
    const respuesta = await leerArchivo(token, RUTA_ALPACA);
    return respuesta.ok ? ((await respuesta.json()) as CuentaAlpaca) : undefined;
  } catch {
    return undefined;
  }
}

export async function obtenerSaldoAgente(token: string): Promise<SaldoAgente> {
  const [respuesta, alpaca] = await Promise.all([leerArchivo(token, RUTA_SALDO), obtenerCuentaAlpaca(token)]);
  if (respuesta.status === 404) {
    throw new Error(`Todavía no existe ${RUTA_SALDO} en la rama main de ${REPO_AGENTE}`);
  }
  if (!respuesta.ok) throw new Error(`GitHub respondió ${respuesta.status}`);
  const saldo = (await respuesta.json()) as SaldoAgente;
  return alpaca ? { ...saldo, alpaca } : saldo;
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
