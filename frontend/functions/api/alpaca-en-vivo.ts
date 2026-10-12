// Cloudflare Pages Function: GET /api/alpaca-en-vivo
//
// Lo que muestra el botón "Actualizar" de la cuenta de Alpaca en "Agente de trading": la misma foto
// que escribe el agente en output/alpaca.json (agent/broker.py, estado_cuenta), pero leída en este
// momento de la API de Alpaca en vez de esperar a la próxima corrida del agente.
//
// Solo cuenta de prueba (paper) y solo lecturas: la URL base es fija y únicamente se hacen GET, así
// que estas llaves no pueden mandar órdenes desde aquí. Las llaves van en las variables de entorno
// ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY de Cloudflare Pages (las mismas que usa el agente en
// GitHub); sin ellas responde 503 con un mensaje que la pestaña muestra tal cual.

import type { CuentaAlpaca, OrdenAlpaca, PosicionAlpaca } from "./agente-saldo.ts";

export const URL_ALPACA_PAPER = "https://paper-api.alpaca.markets";

interface Entorno {
  ALPACA_API_KEY_ID?: string;
  ALPACA_API_SECRET_KEY?: string;
}

type Crudo = Record<string, unknown>;

/** Alpaca manda los montos como texto ("1234.5"); vacío o inválido → null. */
function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

/** Arma el mismo formato que output/alpaca.json a partir de las respuestas crudas de Alpaca. */
export function armarCuentaAlpaca(
  cuenta: Crudo,
  posiciones: Crudo[],
  ordenes: Crudo[],
  historial: { timestamp?: number[] | null; equity?: (number | null)[] | null },
  ahora: Date
): CuentaAlpaca {
  const equity = numero(cuenta.equity);
  const puntos = new Map<string, number>();
  const tiempos = historial.timestamp ?? [];
  const valores = historial.equity ?? [];
  tiempos.forEach((ts, i) => {
    const valor = valores[i];
    // Alpaca rellena con 0 los días antes de abrir la cuenta.
    if (valor) puntos.set(new Date(ts * 1000).toISOString().slice(0, 10), Math.round(valor * 100) / 100);
  });
  if (equity !== null) puntos.set(ahora.toISOString().slice(0, 10), Math.round(equity * 100) / 100);

  const listaPosiciones: PosicionAlpaca[] = posiciones.map((p) => ({
    symbol: String(p.symbol),
    asset_class: texto(p.asset_class),
    qty: numero(p.qty),
    avg_entry_price: numero(p.avg_entry_price),
    current_price: numero(p.current_price),
    market_value: numero(p.market_value),
    cost_basis: numero(p.cost_basis),
    unrealized_pl: numero(p.unrealized_pl),
    unrealized_plpc: numero(p.unrealized_plpc),
  }));
  const listaOrdenes: OrdenAlpaca[] = ordenes.map((o) => ({
    submitted_at: texto(o.submitted_at),
    filled_at: texto(o.filled_at),
    symbol: String(o.symbol),
    side: o.side === "sell" ? "sell" : "buy",
    notional: numero(o.notional),
    qty: numero(o.qty),
    filled_qty: numero(o.filled_qty),
    filled_avg_price: numero(o.filled_avg_price),
    status: texto(o.status),
  }));

  return {
    broker: "alpaca-paper",
    actualizado: ahora.toISOString().replace(/\.\d{3}Z$/, "Z"),
    moneda: texto(cuenta.currency) ?? "USD",
    equity,
    last_equity: numero(cuenta.last_equity),
    cash: numero(cuenta.cash),
    posiciones: listaPosiciones.sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0)),
    ordenes: listaOrdenes,
    historial: [...puntos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, valor]) => ({ date, equity: valor })),
  };
}

export async function obtenerCuentaAlpacaEnVivo(llave: string, secreto: string): Promise<CuentaAlpaca> {
  const pedir = async <T>(ruta: string): Promise<T> => {
    const respuesta = await fetch(URL_ALPACA_PAPER + ruta, {
      headers: { "APCA-API-KEY-ID": llave, "APCA-API-SECRET-KEY": secreto, Accept: "application/json" },
    });
    if (respuesta.status === 401 || respuesta.status === 403) {
      throw new Error("Alpaca rechazó las llaves: revisa ALPACA_API_KEY_ID y ALPACA_API_SECRET_KEY en Cloudflare Pages");
    }
    if (!respuesta.ok) throw new Error(`Alpaca respondió ${respuesta.status} en ${ruta.split("?")[0]}`);
    return (await respuesta.json()) as T;
  };
  const [cuenta, posiciones, ordenes, historial] = await Promise.all([
    pedir<Crudo>("/v2/account"),
    pedir<Crudo[]>("/v2/positions"),
    pedir<Crudo[]>("/v2/orders?status=all&limit=100&direction=desc&nested=false"),
    // El historial es solo para la gráfica: si falla, se muestra lo demás.
    pedir<{ timestamp?: number[]; equity?: (number | null)[] }>(
      "/v2/account/portfolio/history?period=1A&timeframe=1D"
    ).catch(() => ({})),
  ]);
  return armarCuentaAlpaca(cuenta, posiciones ?? [], ordenes ?? [], historial, new Date());
}

export async function onRequestGet({ env }: { request: Request; env?: Entorno }): Promise<Response> {
  const llave = env?.ALPACA_API_KEY_ID;
  const secreto = env?.ALPACA_API_SECRET_KEY;
  if (!llave || !secreto) {
    return Response.json(
      {
        error:
          "Para actualizar en vivo falta guardar ALPACA_API_KEY_ID y ALPACA_API_SECRET_KEY en Cloudflare Pages (Settings → Variables and Secrets)",
      },
      { status: 503 }
    );
  }
  try {
    const cuenta = await obtenerCuentaAlpacaEnVivo(llave, secreto);
    return Response.json(cuenta, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
