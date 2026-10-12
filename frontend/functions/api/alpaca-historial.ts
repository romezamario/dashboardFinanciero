// Cloudflare Pages Function: GET /api/alpaca-historial?rango=1D|1M|1A|todo
//
// Valor de la cuenta de prueba de Alpaca a lo largo del tiempo, con el detalle que usa Alpaca en su
// propia gráfica: cada 5 minutos en "1D", cada hora en "1M" y por día en "1A"/"todo". El archivo
// output/alpaca.json del agente solo guarda un punto por día, así que la gráfica de 1 día sale de aquí.
// Mismas llaves y mismas reglas que /api/alpaca-en-vivo: solo GET contra la cuenta paper.

import { faltanLlaves, pedirAlpaca } from "./alpaca-en-vivo.ts";

export type RangoAlpaca = "1D" | "1M" | "1A" | "todo";

/** Parámetros de /v2/account/portfolio/history por rango. "continuous" porque las criptos operan
 * las 24 horas: con el horario de bolsa la gráfica de 1 día quedaría cortada. */
export const PARAMETROS_RANGO: Record<RangoAlpaca, string> = {
  "1D": "period=1D&timeframe=5Min&intraday_reporting=continuous",
  "1M": "period=1M&timeframe=1H&intraday_reporting=continuous",
  "1A": "period=1A&timeframe=1D",
  todo: "period=5A&timeframe=1D",
};

export interface PuntoHistorialAlpaca {
  /** Milisegundos desde 1970 (UTC). */
  t: number;
  valor: number;
}

export function esRangoAlpaca(valor: string | null): valor is RangoAlpaca {
  return valor !== null && valor in PARAMETROS_RANGO;
}

/** Une los arreglos paralelos de Alpaca en puntos. Alpaca rellena con 0 (o null) los ratos antes de
 * abrir la cuenta y los huecos sin dato: esos no son un valor de la cuenta y se quitan. */
export function puntosDeHistorial(datos: {
  timestamp?: number[] | null;
  equity?: (number | null)[] | null;
}): PuntoHistorialAlpaca[] {
  const valores = datos.equity ?? [];
  const puntos: PuntoHistorialAlpaca[] = [];
  (datos.timestamp ?? []).forEach((ts, i) => {
    const valor = valores[i];
    if (valor) puntos.push({ t: ts * 1000, valor: Math.round(valor * 100) / 100 });
  });
  return puntos.sort((a, b) => a.t - b.t);
}

interface Entorno {
  ALPACA_API_KEY_ID?: string;
  ALPACA_API_SECRET_KEY?: string;
}

export async function onRequestGet({ request, env }: { request: Request; env?: Entorno }): Promise<Response> {
  const llave = env?.ALPACA_API_KEY_ID;
  const secreto = env?.ALPACA_API_SECRET_KEY;
  if (!llave || !secreto) return faltanLlaves();
  const rango = new URL(request.url).searchParams.get("rango") ?? "1D";
  if (!esRangoAlpaca(rango)) return Response.json({ error: `Rango desconocido: ${rango}` }, { status: 400 });
  try {
    const datos = await pedirAlpaca<{ timestamp?: number[]; equity?: (number | null)[] }>(
      llave,
      secreto,
      `/v2/account/portfolio/history?${PARAMETROS_RANGO[rango]}`
    );
    return Response.json(puntosDeHistorial(datos), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
