import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  calcularLecturasMacro,
  diasHasta,
  eventosCalendario,
  GRUPOS,
  DIAS_PUBLICACION_CERCANA,
  fechaLocalHoy,
  nombreFechaPublicacion,
  nombrePeriodo,
  obtenerDatosMacro,
  textoFaltan,
  type ProximaPublicacion,
  type DatosMacro,
  type LecturaMacro,
  type Observacion,
} from "../lib/macro";

const estiloTarjeta = { background: "var(--surface-1)", border: "1px solid var(--border)" };

/** Indicadores macro de EE.UU. que sigue la Fed (y que mueven al Nasdaq-100),
 * agrupados como recuadros con su último dato, el cambio vs. el anterior y una
 * minigráfica de ~2 años. Datos de FRED vía /macro.json (generado en el deploy). */
export function MacroEeuu() {
  const [datos, setDatos] = useState<DatosMacro | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Indicador cuyo histórico está abierto (clic en su recuadro). */
  const [seleccion, setSeleccion] = useState<string | null>(null);

  useEffect(() => {
    obtenerDatosMacro()
      .then(setDatos)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const hoy = fechaLocalHoy();
  const lecturas = useMemo(() => (datos ? calcularLecturasMacro(datos, hoy) : []), [datos, hoy]);
  // Varias series salen en el mismo reporte (empleo, desempleo y salarios el
  // mismo viernes): en el resumen van juntas bajo una sola fecha.
  // Minutas del FOMC y PMI (ISM / S&P Global): solo su fecha, el dato no se
  // puede traer gratis (ver `eventosCalendario`).
  const eventos = useMemo(() => (datos ? eventosCalendario(datos, hoy) : []), [datos, hoy]);
  const cercanas = useMemo(() => {
    const porFecha = new Map<string, string[]>();
    const agregar = (fecha: string, titulo: string) =>
      porFecha.set(fecha, [...(porFecha.get(fecha) ?? []), titulo]);
    for (const l of lecturas) {
      if (l.proxima?.cercana) agregar(l.proxima.fecha, l.titulo);
    }
    for (const e of eventos) {
      const dias = diasHasta(e.fecha, hoy);
      if (dias >= 0 && dias < DIAS_PUBLICACION_CERCANA) agregar(e.fecha, e.titulo);
    }
    return Array.from(porFecha.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [lecturas, eventos, hoy]);
  const fallidas = datos ? Object.keys(datos.errores) : [];

  if (!datos) {
    return (
      <p
        className="text-sm"
        style={{ color: error ? "var(--status-critical)" : "var(--text-secondary)" }}
      >
        {error ? `No se pudieron traer los indicadores: ${error}` : "Cargando indicadores…"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Fuente: FRED (Fed de St. Louis) · descargado el{" "}
        {new Date(datos.actualizado).toLocaleString("es-MX", {
          dateStyle: "medium",
          timeStyle: "short",
        })}{" "}
        · se actualiza solo dos veces al día, de lunes a viernes
      </p>
      {fallidas.length > 0 && (
        <p className="text-xs" style={{ color: "var(--status-critical)" }}>
          No se pudieron descargar: {fallidas.join(", ")}.
        </p>
      )}

      <div className="rounded-lg p-4" style={estiloTarjeta}>
        <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Publicaciones en los próximos {DIAS_PUBLICACION_CERCANA} días
        </h3>
        {cercanas.length === 0 ? (
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Ninguna. Cada recuadro indica cuándo sale su siguiente dato.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {cercanas.map(([fecha, titulos]) => {
              const dias = diasHasta(fecha, hoy);
              return (
                <li key={fecha} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <InsigniaFecha fecha={fecha} dias={dias} hoy={hoy} />
                  <span style={{ color: "var(--text-primary)" }}>{titulos.join(" · ")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {GRUPOS.map((grupo) => {
        const delGrupo = lecturas.filter((l) => l.grupo === grupo);
        if (delGrupo.length === 0) return null;
        return (
          <section key={grupo} className="space-y-3">
            <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {grupo}
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {delGrupo.map((l) => (
                <TileMacro
                  key={l.id}
                  lectura={l}
                  seleccionado={seleccion === l.id}
                  onClick={() => setSeleccion((actual) => (actual === l.id ? null : l.id))}
                />
              ))}
            </div>
            {/* El histórico se abre debajo del grupo de su recuadro, no al final
             * de la página, para que quede a la vista sin desplazarse. */}
            {delGrupo.map(
              (l) =>
                l.id === seleccion && (
                  <DetalleIndicador key={l.id} lectura={l} onCerrar={() => setSeleccion(null)} />
                )
            )}
          </section>
        );
      })}

      <section className="space-y-3">
        <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Calendario (sin dato en el tablero)
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {eventos.map((e) => {
            const dias = diasHasta(e.fecha, hoy);
            return (
              <div key={e.id} className="rounded-lg p-4" style={estiloTarjeta}>
                <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {e.titulo}
                </div>
                <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  <div>{e.estimada ? "Próxima publicación (estimada):" : "Próxima publicación:"}</div>
                  {dias < DIAS_PUBLICACION_CERCANA ? (
                    <InsigniaFecha fecha={e.fecha} dias={dias} hoy={hoy} />
                  ) : (
                    <span style={{ color: "var(--text-secondary)" }}>
                      {nombreFechaPublicacion(e.fecha, hoy)} · {textoFaltan(dias)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {e.nota}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Cada dato corresponde al periodo indicado (no a su fecha de publicación) y FRED lo
        actualiza horas después de que sale el reporte oficial. Las series diarias se comparan
        contra el cierre del mes anterior. Verde/rojo = si el cambio suele ser buena o mala noticia
        para el Nasdaq-100: menos inflación, tasas y volatilidad, y más crecimiento y empleo, en
        verde (un dato de empleo muy fuerte puede leerse al revés si aleja los recortes de la Fed).
        La curva 10a−2a va sin color. Da clic en un recuadro para ver su histórico.
      </p>
    </div>
  );
}

function TileMacro({
  lectura,
  seleccionado,
  onClick,
}: {
  lectura: LecturaMacro;
  seleccionado: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={seleccionado}
      className="flex flex-col rounded-lg p-4 text-left"
      style={{
        ...estiloTarjeta,
        borderColor: seleccionado ? "var(--series-1)" : "var(--border)",
        boxShadow: seleccionado ? "0 0 0 1px var(--series-1)" : undefined,
      }}
      title={`${lectura.descripcion} Clic para ver el histórico.`}
    >
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {lectura.titulo}
      </div>
      <div
        className="mt-1 text-xl font-semibold"
        style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
      >
        {lectura.valor}
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {lectura.periodo}
      </div>
      {lectura.cambio && (
        <div
          className="mt-1 text-xs"
          style={{
            color:
              lectura.tono === "favorable"
                ? "var(--status-good)"
                : lectura.tono === "desfavorable"
                  ? "var(--status-critical)"
                  : "var(--text-secondary)",
          }}
        >
          {lectura.cambio}
        </div>
      )}
      {lectura.detalle && (
        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {lectura.detalle}
        </div>
      )}
      <LineaProxima proxima={lectura.proxima} diaria={lectura.frecuencia === "diaria" && lectura.id !== "FED"} />
      <div className="mt-auto pt-3">
        <MiniTendencia
          historia={lectura.historia}
          referencia={lectura.referencia}
          formato={lectura.formatoHistoria}
          etiqueta={lectura.titulo}
        />
      </div>
    </button>
  );
}

// ------------------------------------------------------------ calendario

/** Fecha de publicación + cuánto falta. Si faltan menos de 5 días se resalta
 * con fondo amarillo (slot 4 de la paleta, ya validado) y texto en tinta
 * primaria: el color no va solo, el "hoy / mañana / en N días" lo dice. */
function InsigniaFecha({ fecha, dias, hoy }: { fecha: string; dias: number; hoy: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
      style={{
        background: "color-mix(in srgb, var(--series-4) 22%, transparent)",
        border: "1px solid var(--series-4)",
        color: "var(--text-primary)",
      }}
    >
      ⏰ {nombreFechaPublicacion(fecha, hoy)} · {textoFaltan(dias)}
    </span>
  );
}

function LineaProxima({ proxima, diaria }: { proxima: ProximaPublicacion | null; diaria: boolean }) {
  const hoy = fechaLocalHoy();
  if (!proxima) {
    return diaria ? (
      <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Se actualiza cada día hábil
      </div>
    ) : null;
  }
  return (
    <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
      <div>{proxima.etiqueta}:</div>
      {proxima.cercana ? (
        <InsigniaFecha fecha={proxima.fecha} dias={proxima.dias} hoy={hoy} />
      ) : (
        <span style={{ color: "var(--text-secondary)" }}>
          {nombreFechaPublicacion(proxima.fecha, hoy)} · {textoFaltan(proxima.dias)}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------ histórico

const RANGOS = [
  { id: "1A", anios: 1 },
  { id: "2A", anios: 2 },
  { id: "5A", anios: 5 },
  { id: "10A", anios: 10 },
] as const;
type Rango = (typeof RANGOS)[number]["id"];

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Gráfica con todo el histórico descargado de un indicador (hasta 10 años),
 * con selector de rango. Se abre al dar clic en su recuadro. */
function DetalleIndicador({ lectura, onCerrar }: { lectura: LecturaMacro; onCerrar: () => void }) {
  const [rango, setRango] = useState<Rango>("5A");
  const serie = lectura.serieCompleta;
  const ultimaFecha = serie[serie.length - 1]?.fecha ?? "";
  const datos = useMemo(() => {
    const fecha = new Date(`${ultimaFecha}T00:00:00Z`);
    fecha.setUTCFullYear(fecha.getUTCFullYear() - RANGOS.find((r) => r.id === rango)!.anios);
    const desde = fecha.toISOString().slice(0, 10);
    return serie.filter((o) => o.fecha >= desde);
  }, [serie, ultimaFecha, rango]);
  const formatoPunto = lectura.formatoPunto ?? ((o: Observacion) => lectura.formatoHistoria(o.valor));
  const valores = datos.map((o) => o.valor);
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  // La referencia (meta de 2%, 0) solo se dibuja si queda cerca del rango
  // visible; si no, aplastaría la serie contra un borde.
  const holgura = (maximo - minimo || 1) * 0.5;
  const referencia =
    lectura.referencia != null &&
    lectura.referencia >= minimo - holgura &&
    lectura.referencia <= maximo + holgura
      ? lectura.referencia
      : undefined;
  const esBarras = lectura.grafica === "barras";
  // Una marca por año (o por mes en 1A), en el primer dato de cada uno; los
  // ticks automáticos repetían el año varias veces.
  const ticks = useMemo(() => {
    const largo = rango === "1A" ? 7 : 4;
    return datos
      .filter((o, i) => i > 0 && o.fecha.slice(0, largo) !== datos[i - 1].fecha.slice(0, largo))
      .map((o) => o.fecha);
  }, [datos, rango]);

  const ejeX = (
    <XAxis
      dataKey="fecha"
      ticks={ticks}
      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
      axisLine={false}
      tickLine={false}
      minTickGap={24}
      tickFormatter={(f: string) => {
        const [anio, mes] = f.split("-").map(Number);
        return rango === "1A" ? `${MESES_CORTOS[mes - 1]} ${String(anio).slice(2)}` : String(anio);
      }}
    />
  );
  const ejeY = (
    <YAxis
      orientation="right"
      width={64}
      // Con barras el dominio debe incluir el 0 aunque todo sea positivo.
      domain={
        esBarras
          ? [(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]
          : lectura.grafica === "escalon"
            ? // La tasa de la Fed desde 0; con "auto" el eje llegaba hasta 8%.
              [0, (max: number) => Math.ceil(max + 0.25)]
            : ["auto", "auto"]
      }
      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
      axisLine={false}
      tickLine={false}
      tickFormatter={(v: number) => lectura.formatoHistoria(v)}
    />
  );
  const tooltip = (
    <Tooltip
      cursor={esBarras ? { fill: "var(--gridline)", opacity: 0.4 } : { stroke: "var(--baseline)" }}
      content={({ active, payload }) => {
        if (!active || !payload?.length) return null;
        const o = payload[0].payload as Observacion;
        return (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ ...estiloTarjeta, color: "var(--text-primary)" }}>
            <div className="font-medium">{nombrePeriodo(o.fecha, lectura.frecuencia)}</div>
            <div style={{ color: "var(--text-secondary)" }}>{formatoPunto(o)}</div>
          </div>
        );
      }}
    />
  );
  const lineaReferencia =
    referencia == null ? null : (
      <ReferenceLine
        y={referencia}
        // Sin esto Recharts no la dibuja si cae fuera del rango de los datos
        // (p. ej. la meta de 2% cuando la inflación lleva años arriba).
        ifOverflow="extendDomain"
        stroke="var(--baseline)"
        strokeDasharray={referencia === 0 ? undefined : "4 3"}
        label={
          referencia === 0
            ? undefined
            : {
                value: `Meta ${lectura.formatoHistoria(referencia)}`,
                position: "insideTopLeft",
                fill: "var(--text-muted)",
                fontSize: 11,
              }
        }
      />
    );

  return (
    <div className="rounded-lg p-4" style={estiloTarjeta}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {lectura.titulo}: histórico
          </h4>
          <p className="mt-1 max-w-xl text-xs" style={{ color: "var(--text-muted)" }}>
            {lectura.descripcion}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="inline-flex rounded-md p-0.5"
            style={{ background: "var(--page-plane)", border: "1px solid var(--border)" }}
          >
            {RANGOS.map((r) => (
              <button
                key={r.id}
                onClick={() => setRango(r.id)}
                className="rounded px-2 py-0.5 text-xs font-medium"
                style={{
                  background: rango === r.id ? "var(--surface-1)" : "transparent",
                  color: rango === r.id ? "var(--text-primary)" : "var(--text-secondary)",
                  boxShadow: rango === r.id ? "0 0 0 1px var(--border)" : undefined,
                }}
              >
                {r.id}
              </button>
            ))}
          </div>
          <button
            onClick={onCerrar}
            aria-label="Cerrar histórico"
            className="rounded px-2 py-0.5 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          {esBarras ? (
            <BarChart data={datos} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" />
              {ejeX}
              {ejeY}
              <ReferenceLine y={0} stroke="var(--baseline)" />
              {tooltip}
              {/* Polaridad sobre 0 con los dos tonos ya validados (azul arriba,
               * naranja abajo), igual que el FlujoNetoChart. */}
              <Bar dataKey="valor" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {datos.map((o) => (
                  <Cell key={o.fecha} fill={o.valor >= 0 ? "var(--series-1)" : "var(--series-2)"} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={datos} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" />
              {ejeX}
              {ejeY}
              {lineaReferencia}
              {tooltip}
              <Line
                dataKey="valor"
                type={lectura.grafica === "escalon" ? "stepAfter" : "linear"}
                stroke="var(--series-1)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      {datos.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Desde {nombrePeriodo(datos[0].fecha, lectura.frecuencia)} · mínimo{" "}
          {formatoPunto(datos[valores.indexOf(minimo)])} · máximo{" "}
          {formatoPunto(datos[valores.indexOf(maximo)])}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------- minigráfica

const ANCHO = 160;
const ALTO = 36;
const MARGEN = 3;

/** Minigráfica escalada al mínimo/máximo de la propia serie (tasas e
 * inflación se mueven en rangos chicos; desde 0 se verían planas). La línea
 * punteada es la referencia (meta de 2%, cero) cuando cae dentro del rango. */
function MiniTendencia({
  historia,
  referencia,
  formato,
  etiqueta,
}: {
  historia: Observacion[];
  referencia?: number;
  formato: (v: number) => string;
  etiqueta: string;
}) {
  if (historia.length < 2) return null;
  const valores = historia.map((o) => o.valor);
  const minimo = Math.min(...valores, referencia ?? Infinity);
  const maximo = Math.max(...valores, referencia ?? -Infinity);
  const rango = maximo - minimo || 1;
  const paso = (ANCHO - MARGEN * 2) / (historia.length - 1);
  const aY = (v: number) => ALTO - MARGEN - ((v - minimo) / rango) * (ALTO - MARGEN * 2);
  const puntos = historia.map((o, i) => ({ x: MARGEN + i * paso, y: aY(o.valor) }));
  const ultimo = puntos[puntos.length - 1];
  return (
    <svg
      viewBox={`0 0 ${ANCHO} ${ALTO}`}
      className="block h-9 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Tendencia de ${etiqueta}: de ${formato(valores[0])} a ${formato(
        valores[valores.length - 1]
      )}`}
      style={{ overflow: "visible" }}
    >
      {referencia != null && (
        <line
          x1={0}
          x2={ANCHO}
          y1={aY(referencia)}
          y2={aY(referencia)}
          stroke="var(--baseline)"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        points={puntos.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={ultimo.x} cy={ultimo.y} r={2.5} fill="var(--series-1)" />
      {/* Zonas invisibles por punto, más anchas que el trazo, para el tooltip. */}
      {historia.map((o, i) => (
        <rect key={o.fecha} x={puntos[i].x - paso / 2} y={0} width={paso} height={ALTO} fill="transparent">
          <title>{`${o.fecha}: ${formato(o.valor)}`}</title>
        </rect>
      ))}
    </svg>
  );
}
