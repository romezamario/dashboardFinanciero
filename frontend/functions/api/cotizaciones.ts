// Cloudflare Pages Function: GET /api/cotizaciones?simbolo=QQQ
//
// Velas diarias (10 años) para la pestaña de análisis técnico. Vive en el
// mismo dominio que el frontend, así que queda detrás del mismo Cloudflare
// Access y el navegador no choca con CORS (Yahoo no permite llamarlo directo
// desde el navegador). Solo acepta los símbolos de SIMBOLOS_PERMITIDOS para
// no ser un proxy abierto. Sin llave ni costo: usa el endpoint público de
// gráficas de Yahoo Finance (no oficial -- si un día cambia o bloquea, el
// error se muestra en la pestaña y el resto del dashboard no se entera).
//
// En `npm run dev`, vite.config.ts monta este mismo handler como middleware.

export const SIMBOLOS_PERMITIDOS = ["QQQ", "TQQQ"] as const;
export type Simbolo = (typeof SIMBOLOS_PERMITIDOS)[number];

const SEGUNDOS_EN_CACHE = 300;

export interface Vela {
  /** YYYY-MM-DD, día de operación en Nueva York. */
  fecha: string;
  apertura: number;
  maximo: number;
  minimo: number;
  cierre: number;
  volumen: number;
}

export interface SerieCotizaciones {
  simbolo: Simbolo;
  nombre: string;
  /** Hora (ISO) del último precio que reporta Yahoo; si el mercado está
   * abierto, la última vela es la del día en curso, aún sin cerrar. */
  actualizado: string;
  velas: Vela[];
}

interface RespuestaYahoo {
  chart: {
    result?: {
      meta: { longName?: string; shortName?: string; regularMarketTime: number; gmtoffset: number };
      timestamp?: number[];
      indicators: {
        quote: {
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }[];
      };
    }[];
    error?: { description?: string } | null;
  };
}

function redondear(valor: number): number {
  return Math.round(valor * 10000) / 10000;
}

export async function obtenerSerie(simbolo: Simbolo): Promise<SerieCotizaciones> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${simbolo}?range=10y&interval=1d`;
  // Sin User-Agent de navegador Yahoo suele responder 429. `cf.cacheTtl`
  // guarda la respuesta de Yahoo 5 min en la caché de Cloudflare (los datos
  // son públicos e iguales para todos): recargar la pestaña o abrirla desde
  // otro dispositivo no vuelve a pegarle a Yahoo, que es más lento y limita
  // por frecuencia. Fuera de Cloudflare (`npm run dev`) se ignora.
  const respuesta = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cf: { cacheTtl: SEGUNDOS_EN_CACHE, cacheEverything: true },
  } as RequestInit);
  if (!respuesta.ok) throw new Error(`Yahoo Finance respondió ${respuesta.status}`);
  const cuerpo = (await respuesta.json()) as RespuestaYahoo;
  const resultado = cuerpo.chart.result?.[0];
  if (!resultado?.timestamp) {
    throw new Error(cuerpo.chart.error?.description ?? "Respuesta sin datos");
  }
  const { meta, timestamp } = resultado;
  const q = resultado.indicators.quote[0];
  const velas: Vela[] = [];
  timestamp.forEach((ts, i) => {
    const [apertura, maximo, minimo, cierre] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    // Yahoo deja huecos en null (feriados a medias, días sin operación).
    if (apertura == null || maximo == null || minimo == null || cierre == null) return;
    velas.push({
      // ts = apertura (9:30 NY); sumar el desfase deja la fecha local.
      fecha: new Date((ts + meta.gmtoffset) * 1000).toISOString().slice(0, 10),
      apertura: redondear(apertura),
      maximo: redondear(maximo),
      minimo: redondear(minimo),
      cierre: redondear(cierre),
      volumen: q.volume[i] ?? 0,
    });
  });
  return {
    simbolo,
    nombre: meta.longName ?? meta.shortName ?? simbolo,
    actualizado: new Date(meta.regularMarketTime * 1000).toISOString(),
    velas,
  };
}

export async function onRequestGet({ request }: { request: Request }): Promise<Response> {
  const simbolo = new URL(request.url).searchParams.get("simbolo")?.toUpperCase() ?? "";
  if (!(SIMBOLOS_PERMITIDOS as readonly string[]).includes(simbolo)) {
    return Response.json({ error: `Símbolo no permitido: ${simbolo}` }, { status: 400 });
  }
  try {
    const serie = await obtenerSerie(simbolo as Simbolo);
    return Response.json(serie, { headers: { "Cache-Control": `private, max-age=${SEGUNDOS_EN_CACHE}` } });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
