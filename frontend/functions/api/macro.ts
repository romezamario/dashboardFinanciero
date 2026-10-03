// Cloudflare Pages Function: GET /api/macro
//
// Indicadores macro de EE.UU. (Fed, inflación, empleo, crecimiento) desde
// FRED, la base de datos de la Fed de St. Louis. Usa la descarga CSV pública
// de las gráficas de FRED, que no pide llave (la API "oficial" sí). Ojo: FRED
// rechaza/cuelga peticiones con User-Agent de navegador falso, por eso se
// identifica con uno propio. Igual que /api/cotizaciones: mismo dominio,
// detrás de Cloudflare Access, y solo baja las series de SERIES_MACRO.

export const SERIES_MACRO = [
  "DFEDTARU", // rango objetivo de la Fed, límite superior (diario)
  "DFEDTARL", // ... límite inferior
  "DGS2", // bono del Tesoro a 2 años
  "DGS10", // bono del Tesoro a 10 años
  "T10Y2Y", // diferencial 10 años − 2 años
  "PCEPILFE", // índice PCE subyacente (sin alimentos ni energía)
  "PCEPI", // índice PCE general
  "CPIAUCSL", // índice CPI general
  "CPILFESL", // índice CPI subyacente
  "PAYEMS", // nómina no agrícola (miles de empleos)
  "UNRATE", // tasa de desempleo
  "ICSA", // solicitudes iniciales de subsidio por desempleo (semanal)
  "CES0500000003", // salario promedio por hora, sector privado
  "JTSJOL", // vacantes JOLTS (miles)
  "A191RL1Q225SBEA", // PIB real, variación trimestral anualizada
  "RSAFS", // ventas minoristas (millones de USD)
  "UMCSENT", // sentimiento del consumidor, U. de Michigan
  "VIXCLS", // índice de volatilidad VIX
] as const;

export type SerieMacro = (typeof SERIES_MACRO)[number];

export interface DatosMacro {
  /** Cuándo se descargó (ISO). */
  actualizado: string;
  /** Observaciones [fecha YYYY-MM-DD, valor] en orden ascendente. Una serie
   * que falló llega vacía y su error en `errores`, sin tumbar las demás. */
  series: Record<SerieMacro, [string, number][]>;
  errores: Partial<Record<SerieMacro, string>>;
}

// 4 años: las variaciones anuales necesitan 12 meses previos y las
// minigráficas muestran 2 años; el resto es margen (p. ej. para encontrar el
// último cambio de tasa de la Fed).
const ANIOS_HISTORIA = 4;

async function descargarSerie(id: SerieMacro, desde: string): Promise<[string, number][]> {
  const respuesta = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${desde}`,
    { headers: { "User-Agent": "DashboardFinanciero/1.0" } }
  );
  if (!respuesta.ok) throw new Error(`FRED respondió ${respuesta.status}`);
  const texto = await respuesta.text();
  const observaciones: [string, number][] = [];
  for (const linea of texto.trim().split("\n").slice(1)) {
    const [fecha, valor] = linea.trim().split(",");
    const numero = Number(valor);
    // FRED marca los días sin dato (feriados) con ".".
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha) && valor !== "." && Number.isFinite(numero)) {
      observaciones.push([fecha, numero]);
    }
  }
  return observaciones;
}

export async function obtenerDatosMacro(): Promise<DatosMacro> {
  const inicio = new Date();
  inicio.setUTCFullYear(inicio.getUTCFullYear() - ANIOS_HISTORIA);
  const desde = inicio.toISOString().slice(0, 10);
  const resultados = await Promise.allSettled(SERIES_MACRO.map((id) => descargarSerie(id, desde)));
  const series = {} as DatosMacro["series"];
  const errores: DatosMacro["errores"] = {};
  resultados.forEach((r, i) => {
    const id = SERIES_MACRO[i];
    series[id] = r.status === "fulfilled" ? r.value : [];
    if (r.status === "rejected") {
      errores[id] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  });
  return { actualizado: new Date().toISOString(), series, errores };
}

export async function onRequestGet(): Promise<Response> {
  const datos = await obtenerDatosMacro();
  if (Object.keys(datos.errores).length === SERIES_MACRO.length) {
    return Response.json(
      { error: `No se pudo descargar ninguna serie de FRED (${Object.values(datos.errores)[0]})` },
      { status: 502 }
    );
  }
  // Las series cambian como mucho una vez al día.
  return Response.json(datos, { headers: { "Cache-Control": "private, max-age=3600" } });
}
