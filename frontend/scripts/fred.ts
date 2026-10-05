// Descarga de los indicadores macro de EE.UU. (Fed, inflación, empleo,
// crecimiento) desde FRED, la base de datos de la Fed de St. Louis. Usa la
// descarga CSV pública de las gráficas de FRED, que no pide llave (la API
// "oficial" sí). Ojo: FRED cuelga peticiones con User-Agent de navegador
// falso, por eso se identifica con uno propio.
//
// NO corre en Cloudflare: FRED responde 520 a las peticiones que salen de
// Cloudflare (se probó como Pages Function y falló en producción), y no
// permite CORS para llamarlo desde el navegador. Por eso lo ejecuta GitHub
// Actions (scripts/descargar-macro.ts) antes del build y el resultado se
// publica como archivo estático, /macro.json. En `npm run dev`,
// vite.config.ts sirve /macro.json descargándolo en vivo con esta función.

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
  /** Fecha (YYYY-MM-DD) de la próxima publicación de cada serie no diaria,
   * según la ficha de la serie en FRED. Las diarias no la tienen (salen cada
   * día hábil). Falta si no se pudo leer; nunca tumba la descarga. */
  proximasPublicaciones?: Partial<Record<SerieMacro, string>>;
  /** Días de anuncio de decisión del FOMC (segundo día de cada reunión), del
   * año anterior, el en curso y el siguiente, según federalreserve.gov. Las
   * minutas salen 3 semanas después de cada uno. */
  reunionesFomc?: string[];
}

/** Series con fecha de publicación propia (las diarias se actualizan cada día
 * hábil, así que "la próxima" siempre sería mañana). */
export const SERIES_CON_CALENDARIO: SerieMacro[] = [
  "PCEPILFE",
  "PCEPI",
  "CPIAUCSL",
  "CPILFESL",
  "PAYEMS",
  "UNRATE",
  "ICSA",
  "CES0500000003",
  "JTSJOL",
  "A191RL1Q225SBEA",
  "RSAFS",
  "UMCSENT",
];

// 10 años: lo que alcanza a ver la gráfica histórica al dar clic en un
// indicador (las variaciones anuales "gastan" los primeros 12 meses). ~0.4 MB
// de JSON, ~70 KB comprimido.
const ANIOS_HISTORIA = 10;

const INTENTOS = 3;

/** FRED a veces responde 502 a una serie suelta (pasó en el deploy con la
 * tasa de la Fed): se reintenta con espera creciente antes de darla por
 * perdida. */
async function descargarCsv(url: string): Promise<string> {
  let ultimoError: Error | null = null;
  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const respuesta = await fetch(url, { headers: { "User-Agent": "DashboardFinanciero/1.0" } });
      if (respuesta.ok) return await respuesta.text();
      ultimoError = new Error(`FRED respondió ${respuesta.status}`);
    } catch (e) {
      ultimoError = e instanceof Error ? e : new Error(String(e));
    }
    if (intento < INTENTOS) await new Promise((r) => setTimeout(r, 2000 * intento));
  }
  throw ultimoError!;
}

async function descargarSerie(id: SerieMacro, desde: string): Promise<[string, number][]> {
  const texto = await descargarCsv(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${desde}`
  );
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
  const [proximasPublicaciones, reunionesFomc] = await Promise.all([
    obtenerProximasPublicaciones(),
    obtenerReunionesFomc().catch((e: unknown) => {
      console.warn(`No se pudo leer el calendario del FOMC: ${e instanceof Error ? e.message : e}`);
      return [];
    }),
  ]);
  return {
    actualizado: new Date().toISOString(),
    series,
    errores,
    proximasPublicaciones,
    reunionesFomc,
  };
}

// ------------------------------------------------------------ calendario

const MESES_INGLES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** "Nov 6, 2026" -> "2026-11-06". */
function fechaInglesAIso(texto: string): string | null {
  const m = texto.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})$/);
  const mes = m && MESES_INGLES[m[1].toLowerCase()];
  return m && mes ? iso(Number(m[3]), mes, Number(m[2])) : null;
}

/** La ficha HTML de cada serie en FRED trae "Next Release Date: Nov 6, 2026"
 * (no hay CSV de esto sin llave de la API). Si FRED cambia su HTML, la fecha
 * simplemente deja de aparecer en el recuadro. */
async function obtenerProximasPublicaciones(): Promise<Partial<Record<SerieMacro, string>>> {
  const salida: Partial<Record<SerieMacro, string>> = {};
  await Promise.all(
    SERIES_CON_CALENDARIO.map(async (id) => {
      try {
        const html = (await descargarCsv(`https://fred.stlouisfed.org/series/${id}`)).replace(/\s+/g, " ");
        const m = html.match(/Next Release Date:\s*(?:<[^>]+>\s*)*([A-Za-z]{3,9}\.? \d{1,2}, \d{4})/);
        const fecha = m && fechaInglesAIso(m[1]);
        if (fecha) salida[id] = fecha;
        else console.warn(`Sin "Next Release Date" en la ficha de ${id}`);
      } catch (e) {
        console.warn(`No se pudo leer la ficha de ${id}: ${e instanceof Error ? e.message : e}`);
      }
    })
  );
  return salida;
}

/** Calendario oficial del FOMC: por año, bloques con el mes ("October", o
 * "Apr/May" si la reunión cruza de mes) y los días ("27-28", con "*" si trae
 * proyecciones). La decisión se anuncia el último día. */
async function obtenerReunionesFomc(): Promise<string[]> {
  const html = await descargarCsv("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm");
  const anioActual = new Date().getUTCFullYear();
  const fechas: string[] = [];
  // También el año anterior: las minutas de su última reunión (diciembre)
  // salen en enero.
  for (const anio of [anioActual - 1, anioActual, anioActual + 1]) {
    const inicio = html.indexOf(`${anio} FOMC Meetings`);
    if (inicio < 0) continue;
    const fin = html.indexOf("FOMC Meetings", inicio + 20);
    const bloque = html.slice(inicio, fin > 0 ? fin : undefined);
    const patron =
      /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g;
    for (const [, meses, dias] of bloque.matchAll(patron)) {
      const ultimoMes = MESES_INGLES[meses.split("/").pop()!.trim().slice(0, 3).toLowerCase()];
      const ultimoDia = Number(dias.replace(/[^\d-]/g, "").split("-").pop());
      if (ultimoMes && ultimoDia) fechas.push(iso(anio, ultimoMes, ultimoDia));
    }
  }
  if (fechas.length === 0) throw new Error("no se encontraron reuniones en la página");
  return fechas.sort();
}
