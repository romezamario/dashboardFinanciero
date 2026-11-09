// Gráficas del espacio Salud (Mario, 2026-11-09: "desarrolla todas las
// gráficas"). Datos y cálculos en lib/salud.ts; aquí solo el dibujo. Colores
// por rol (index.css): fases con la paleta validada de COLOR_FASE, una sola
// serie en --series-1/2, rejilla y ejes recesivos, tooltip en cada gráfica.
import { useMemo, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  COLOR_FASE,
  NOMBRE_FASE,
  ORDEN_FASES,
  celdasHR,
  cruceSuenoGasto,
  desviacionTemperatura,
  extremoNoche,
  fasesPorNoche,
  horarioSueno,
  haceCuanto,
  minutosDormido,
  nivelBateria,
  promedio,
  relojDesde18,
  segmentosHipnograma,
  serieNoche,
  tarjetasHoy,
  tendencia,
  type DiaSalud,
  type Fase,
  type LecturaBateria,
  type Tarjeta,
} from "./salud";
import { desplazarMes, semanasDelMes, tituloMes } from "../../lib/gastosCorreo";
import { moneda } from "../../lib/formato";

const EJE = { fill: "var(--text-muted)", fontSize: 12 };
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const horaDe = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
const horasMin = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`;
/** Marcas de eje cada 2 h (en minutos) que cubren el máximo. */
const marcasHoras = (max: number) => Array.from({ length: Math.max(2, Math.ceil(max / 120) + 1) }, (_, i) => i * 120);
const ejeHoras = (m: number) => `${Math.round(m / 60)} h`;

// ------------------------------------------------------------- piezas

export function Panel({ titulo, nota, children, acciones }: { titulo: string; nota?: string; children: ReactNode; acciones?: ReactNode }) {
  return (
    <section className="tarjeta rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {titulo}
        </h3>
        {acciones}
      </div>
      {nota && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {nota}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-24 items-center justify-center rounded-md px-4 py-6 text-center text-sm"
      style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}
    >
      {children}
    </div>
  );
}

function Leyenda({ items }: { items: { color: string; texto: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
      {items.map((i) => (
        <span key={i.texto} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.texto}
        </span>
      ))}
    </div>
  );
}

function Caja({ titulo, lineas }: { titulo: string; lineas: (string | null)[] }) {
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
    >
      <div className="font-medium">{titulo}</div>
      {lineas.filter(Boolean).map((l) => (
        <div key={l} style={{ color: "var(--text-secondary)" }}>
          {l}
        </div>
      ))}
    </div>
  );
}

const leyendaFases = ORDEN_FASES.map((f) => ({ color: COLOR_FASE[f], texto: NOMBRE_FASE[f] }));

// ------------------------------------------------------ 1. tarjetas "Hoy"

function formatoValor(t: Tarjeta): string {
  if (t.valor === null) return "—";
  if (t.metrica.clave === "sueno" || t.metrica.clave === "deuda") return horasMin(Math.max(0, t.valor));
  if (t.metrica.clave === "temp") return `${t.valor.toFixed(1)} °C`;
  if (t.metrica.clave === "pasos") return Math.round(t.valor).toLocaleString("es-MX");
  return `${Math.round(t.valor)} ${t.metrica.unidad}`;
}

export function TarjetasHoy({ dias }: { dias: readonly DiaSalud[] }) {
  const tarjetas = useMemo(() => tarjetasHoy(dias), [dias]);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {tarjetas.map((t) => {
        const bueno = t.cambio === null || t.metrica.mejorAlto === null ? null : (t.cambio > 0) === t.metrica.mejorAlto;
        const decimales = t.metrica.clave === "temp" ? 1 : 0;
        return (
          <li key={t.metrica.clave} className="tarjeta rounded-lg p-3">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t.metrica.nombre}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
              {formatoValor(t)}
            </p>
            <p className="mt-0.5 text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
              {t.valor === null ? (
                "Sin datos aún"
              ) : t.cambio === null ? (
                "Sin historial para comparar"
              ) : (
                <>
                  <span
                    style={{
                      color: bueno === null ? "var(--text-secondary)" : bueno ? "var(--status-good)" : "var(--status-critical)",
                    }}
                    aria-label={bueno === null ? undefined : bueno ? "mejor que tu normal" : "peor que tu normal"}
                  >
                    {t.cambio >= 0 ? "▲" : "▼"}{" "}
                    {t.metrica.clave === "pasos"
                      ? Math.round(Math.abs(t.cambio)).toLocaleString("es-MX")
                      : `${Math.abs(t.cambio).toFixed(decimales)}${t.metrica.unidad === "%" ? " pts" : t.metrica.unidad ? ` ${t.metrica.unidad}` : ""}`}
                  </span>{" "}
                  vs. tu normal
                </>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------- batería del anillo

/** Amarillo de estado "warning" de la paleta de referencia (dataviz); siempre
 * con texto oscuro encima. No hay token compartido de warning en index.css y
 * un subproyecto no lo edita. */
const AMARILLO_AVISO = "#fab219";

export function TarjetaBateria({ lecturas }: { lecturas: readonly LecturaBateria[] | null }) {
  if (lecturas === null) return <Vacio>Cargando batería…</Vacio>;
  const ultima = lecturas.at(-1);
  if (!ultima) return <Vacio>Sin lecturas de batería en las últimas 48 h. La laptop la lee cada hora.</Vacio>;
  const nivel = nivelBateria(ultima.pct);
  const datos = lecturas.map((l) => ({ t: new Date(l.en).getTime() / 1000, pct: l.pct }));
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div>
        <p className="text-3xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
          {ultima.pct}%
          {ultima.cargando && (
            <span className="ml-2 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              ⚡ cargando
            </span>
          )}
        </p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Leída {haceCuanto(ultima.en)} {ultima.origen === "navegador" ? "desde el navegador" : "por la laptop"}
        </p>
        {nivel !== "ok" && (
          <p
            className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
            role="status"
            style={
              nivel === "critica"
                ? { background: "var(--status-critical)", color: "#fff" }
                : { background: AMARILLO_AVISO, color: "#0b0b0b" }
            }
          >
            {nivel === "critica" ? "⚠ Batería crítica: cárgalo ya" : "⚠ Batería baja: cárgalo pronto"}
          </p>
        )}
      </div>
      {datos.length >= 2 && (
        <div className="h-20 min-w-48 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={horaDe} tick={EJE} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={EJE} axisLine={false} tickLine={false} />
              <ReferenceLine y={20} stroke="var(--baseline)" strokeDasharray="4 4" />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <Caja titulo={horaDe((payload[0].payload as { t: number }).t)} lineas={[`${payload[0].value}%`]} />
                  ) : null
                }
              />
              <Line dataKey="pct" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------- 2. hipnograma

export function Hipnograma({ dia }: { dia: DiaSalud | undefined }) {
  const tramos = useMemo(() => segmentosHipnograma(dia?.noche), [dia]);
  const n = dia?.noche;
  if (!n || !tramos.length) return <Vacio>No hay fases de sueño para esta noche.</Vacio>;
  const ini = tramos[0].inicio;
  const total = tramos.at(-1)!.fin - ini;
  const porcentajes: [Fase, number | null | undefined][] = [
    [1, n.deep_pct],
    [2, n.light_pct],
    [3, n.rem_pct],
    [4, n.wake_pct],
  ];
  return (
    <div>
      <div className="flex text-[11px]" style={{ color: "var(--text-muted)" }}>
        <div className="w-20 shrink-0" />
        <div className="flex flex-1 justify-between">
          <span>{n.start ?? horaDe(ini)}</span>
          <span>{n.end ?? horaDe(ini + total)}</span>
        </div>
      </div>
      <div className="mt-1 space-y-1" role="img" aria-label={`Fases de sueño de ${n.start} a ${n.end}`}>
        {[4, 3, 2, 1].map((f) => (
          <div key={f} className="flex items-center">
            <span className="w-20 shrink-0 text-xs" style={{ color: "var(--text-secondary)" }}>
              {NOMBRE_FASE[f as Fase]}
            </span>
            <div className="relative h-5 flex-1 rounded-sm" style={{ background: "var(--page-plane)" }}>
              {tramos
                .filter((t) => t.fase === f)
                .map((t) => (
                  <div
                    key={t.inicio}
                    title={`${NOMBRE_FASE[t.fase]}: ${horaDe(t.inicio)}–${horaDe(t.fin)} (${Math.round((t.fin - t.inicio) / 60)} min)`}
                    className="absolute top-0 h-full rounded-sm"
                    style={{
                      left: `${((t.inicio - ini) / total) * 100}%`,
                      width: `max(2px, calc(${((t.fin - t.inicio) / total) * 100}% - 1px))`,
                      background: COLOR_FASE[t.fase],
                    }}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        {porcentajes.map(([f, pct]) => (
          <span key={f} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_FASE[f] }} />
            {NOMBRE_FASE[f]} {pct == null ? "—" : `${Math.round(pct)}%`}
          </span>
        ))}
        {n.efficiency != null && <span>· Eficiencia {Math.round(n.efficiency)}%</span>}
        {minutosDormido(n) != null && <span>· Dormido {horasMin(minutosDormido(n)!)}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------ 3. HR y HRV de la noche

export function SenalesNoche({ dia }: { dia: DiaSalud | undefined }) {
  const hr = useMemo(() => serieNoche(dia?.noche, "hr"), [dia]);
  const hrv = useMemo(() => serieNoche(dia?.noche, "hrv"), [dia]);
  if (!hr.length && !hrv.length) return <Vacio>No hay ritmo cardiaco ni HRV de esta noche.</Vacio>;
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <MiniLinea titulo="Ritmo cardiaco (lpm)" datos={hr} color="var(--series-2)" unidad="lpm" extremo="min" />
        <MiniLinea titulo="HRV (ms)" datos={hrv} color="var(--series-1)" unidad="ms" extremo="max" />
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Mínimo y máximo sostenidos: cada lectura (cada ~5 min) se compara con sus vecinas, así un solo valor atípico del
        sensor no cuenta.
      </p>
    </div>
  );
}

function MiniLinea({
  titulo,
  datos,
  color,
  unidad,
  extremo,
}: {
  titulo: string;
  datos: { t: number; valor: number }[];
  color: string;
  unidad: string;
  extremo: "min" | "max";
}) {
  const punto = useMemo(() => extremoNoche(datos, extremo), [datos, extremo]);
  const media = promedio(datos.map((d) => d.valor));
  const etiqueta = punto ? `${extremo === "min" ? "Mín" : "Máx"} ${Math.round(punto.valor)} ${unidad} · ${horaDe(punto.t)}` : null;
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {titulo}
        {punto && (
          <>
            {" · "}
            <strong style={{ color: "var(--text-primary)" }}>
              {extremo === "min" ? "mín" : "máx"} {Math.round(punto.valor)}
            </strong>
          </>
        )}
        {media !== null && <span style={{ color: "var(--text-muted)" }}> · promedio {Math.round(media)}</span>}
      </p>
      {datos.length ? (
        <div className="mt-1 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={horaDe} tick={EJE} axisLine={false} tickLine={false} />
              <YAxis domain={["auto", "auto"]} tick={EJE} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <Caja titulo={horaDe((payload[0].payload as { t: number }).t)} lineas={[`${payload[0].value} ${unidad}`]} />
                  ) : null
                }
              />
              <Line dataKey="valor" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
              {punto && (
                <ReferenceLine
                  y={punto.valor}
                  stroke="var(--baseline)"
                  strokeDasharray="4 4"
                  label={{
                    value: etiqueta ?? "",
                    position: extremo === "min" ? "insideBottomRight" : "insideTopRight",
                    fill: "var(--text-primary)",
                    fontSize: 11,
                  }}
                />
              )}
              {punto && <ReferenceDot x={punto.t} y={punto.valor} r={5} fill={color} stroke="var(--surface-1)" strokeWidth={2} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Vacio>Sin datos.</Vacio>
      )}
    </div>
  );
}

// ----------------------------------------- 4. fases por noche + deuda

export function FasesPorNoche({ dias }: { dias: readonly DiaSalud[] }) {
  const datos = useMemo(() => fasesPorNoche(dias), [dias]);
  if (!datos.length) return <Vacio>Aún no hay noches registradas.</Vacio>;
  const conDeuda = datos.some((d) => d.deudaAcumulada !== null);
  return (
    <div>
      <Leyenda items={[...leyendaFases, { color: "var(--baseline)", texto: "Meta 8 h" }]} />
      <div className="mt-2 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="fecha" tickFormatter={fechaCorta} tick={EJE} axisLine={false} tickLine={false} />
            <YAxis ticks={marcasHoras(Math.max(480, ...datos.map((d) => d.profundo + d.ligero + d.rem + d.despierto)))} tickFormatter={ejeHoras} tick={EJE} axisLine={false} tickLine={false} />
            <ReferenceLine y={480} stroke="var(--baseline)" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof datos)[number];
                return (
                  <Caja
                    titulo={fechaCorta(d.fecha)}
                    lineas={[
                      `Profundo: ${horasMin(d.profundo)}`,
                      `Ligero: ${horasMin(d.ligero)}`,
                      `REM: ${horasMin(d.rem)}`,
                      `Despierto: ${horasMin(d.despierto)}`,
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="profundo" stackId="f" fill={COLOR_FASE[1]} stroke="var(--surface-1)" strokeWidth={1} maxBarSize={28} />
            <Bar dataKey="ligero" stackId="f" fill={COLOR_FASE[2]} stroke="var(--surface-1)" strokeWidth={1} maxBarSize={28} />
            <Bar dataKey="rem" stackId="f" fill={COLOR_FASE[3]} stroke="var(--surface-1)" strokeWidth={1} maxBarSize={28} />
            <Bar dataKey="despierto" stackId="f" fill={COLOR_FASE[4]} stroke="var(--surface-1)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        Deuda de sueño acumulada
      </p>
      {conDeuda ? (
        <div className="mt-1 h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" />
              <XAxis dataKey="fecha" tickFormatter={fechaCorta} tick={EJE} axisLine={false} tickLine={false} />
              <YAxis ticks={marcasHoras(Math.max(120, ...datos.map((d) => d.deudaAcumulada ?? 0)))} tickFormatter={ejeHoras} tick={EJE} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <Caja
                      titulo={fechaCorta((payload[0].payload as { fecha: string }).fecha)}
                      lineas={[`Deuda: ${horasMin(Number(payload[0].value) || 0)}`]}
                    />
                  ) : null
                }
              />
              <Area dataKey="deudaAcumulada" stroke="var(--series-2)" strokeWidth={2} fill="var(--series-2)" fillOpacity={0.15} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Vacio>Sin deuda de sueño calculada.</Vacio>
      )}
    </div>
  );
}

// --------------------------------- 5. tendencias con banda de tu normal

export function Tendencia({
  dias,
  leer,
  color,
  unidad,
  vacio,
}: {
  dias: readonly DiaSalud[];
  leer: (d: DiaSalud) => number | null;
  color: string;
  unidad: string;
  vacio: string;
}) {
  const datos = useMemo(
    () => tendencia(dias, leer).map((p) => ({ ...p, banda: p.bajo !== null && p.alto !== null ? [p.bajo, p.alto] : null })),
    [dias, leer]
  );
  if (!datos.some((p) => p.valor !== null)) return <Vacio>{vacio}</Vacio>;
  const conBanda = datos.some((p) => p.banda);
  return (
    <div>
      <Leyenda items={[{ color, texto: "Valor por noche" }, ...(conBanda ? [{ color: "var(--gridline)", texto: "Tu rango normal (30 días)" }] : [])]} />
      <div className="mt-2 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="fecha" tickFormatter={fechaCorta} tick={EJE} axisLine={false} tickLine={false} />
            <YAxis domain={["auto", "auto"]} tick={EJE} axisLine={false} tickLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof datos)[number];
                return (
                  <Caja
                    titulo={fechaCorta(p.fecha)}
                    lineas={[
                      p.valor === null ? "Sin dato" : `${Math.round(p.valor)} ${unidad}`,
                      p.base === null ? null : `Tu normal: ${Math.round(p.base)} ${unidad}`,
                    ]}
                  />
                );
              }}
            />
            {conBanda && <Area dataKey="banda" stroke="none" fill="var(--gridline)" fillOpacity={0.8} connectNulls isAnimationActive={false} />}
            <Line dataKey="valor" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color, stroke: "var(--surface-1)", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!conBanda && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          Tu rango normal aparece con 3 noches o más.
        </p>
      )}
    </div>
  );
}

// ----------------------------------------- 6. temperatura (desviación)

export function Temperatura({ dias }: { dias: readonly DiaSalud[] }) {
  const datos = useMemo(() => desviacionTemperatura(dias), [dias]);
  if (!datos.length) return <Vacio>Aún no hay temperatura nocturna.</Vacio>;
  if (!datos.some((d) => d.desviacion !== null))
    return <Vacio>Tu línea base de temperatura se calcula con 3 noches o más ({datos.length} hasta hoy).</Vacio>;
  return (
    <div>
      <Leyenda items={[{ color: "var(--series-2)", texto: "Más alta que tu base" }, { color: "var(--series-1)", texto: "Más baja" }]} />
      <div className="mt-2 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="fecha" tickFormatter={fechaCorta} tick={EJE} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`} tick={EJE} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke="var(--baseline)" />
            <Tooltip
              cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof datos)[number];
                return (
                  <Caja
                    titulo={fechaCorta(d.fecha)}
                    lineas={[d.desviacion === null ? "Sin línea base aún" : `${d.desviacion > 0 ? "+" : ""}${d.desviacion.toFixed(2)} °C vs. tu base`]}
                  />
                );
              }}
            />
            <Bar dataKey="desviacion" maxBarSize={24} radius={[4, 4, 4, 4]} isAnimationActive={false}
              shape={(props: unknown) => {
                const p = props as { x: number; y: number; width: number; height: number; payload: { desviacion: number | null } };
                if (p.payload.desviacion === null) return <g />;
                const h = Math.abs(p.height);
                const y = p.height < 0 ? p.y + p.height : p.y;
                return <rect x={p.x} y={y} width={p.width} height={Math.max(h, 1)} rx={3} fill={p.payload.desviacion >= 0 ? "var(--series-2)" : "var(--series-1)"} />;
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// -------------------------------------------------- 7. horario de sueño

export function HorarioSueno({ dias }: { dias: readonly DiaSalud[] }) {
  const datos = useMemo(() => horarioSueno(dias), [dias]);
  if (!datos.length) return <Vacio>Aún no hay noches registradas.</Vacio>;
  const ejeMin = Math.max(0, Math.floor(Math.min(...datos.map((d) => d.rango[0])) / 60) * 60 - 60);
  const ejeMax = Math.ceil(Math.max(...datos.map((d) => d.rango[1])) / 60) * 60 + 60;
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--gridline)" />
          <XAxis dataKey="fecha" tickFormatter={fechaCorta} tick={EJE} axisLine={false} tickLine={false} />
          <YAxis
            reversed
            domain={[ejeMin, ejeMax]}
            ticks={Array.from({ length: (ejeMax - ejeMin) / 60 + 1 }, (_, i) => ejeMin + i * 60).filter((_m, i, a) => a.length <= 9 || i % 2 === 0)}
            tickFormatter={relojDesde18}
            tick={EJE}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof datos)[number];
              return <Caja titulo={fechaCorta(d.fecha)} lineas={[`Dormir: ${relojDesde18(d.rango[0])}`, `Despertar: ${relojDesde18(d.rango[1])}`]} />;
            }}
          />
          <Bar dataKey="rango" fill="var(--series-1)" radius={[4, 4, 4, 4]} maxBarSize={20} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------ 8. calendario de sueño

/** Eficiencia 50% → rojo, 95% → verde (tono HSL, mezclado con la tarjeta
 * como el calendario de gastos). El valor va escrito en la celda. */
const colorEficiencia = (ef: number) => {
  const t = Math.min(1, Math.max(0, (ef - 50) / 45));
  return `color-mix(in srgb, hsl(${Math.round(120 * t)} 75% 45%) 30%, var(--surface-1))`;
};
const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function CalendarioSueno({
  dias,
  seleccion,
  onSeleccionar,
}: {
  dias: readonly DiaSalud[];
  seleccion: string | null;
  onSeleccionar: (fecha: string) => void;
}) {
  const porFecha = useMemo(() => new Map(dias.map((d) => [d.fecha, d])), [dias]);
  const ultimoMes = (seleccion ?? dias.at(-1)?.fecha ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  const [mes, setMes] = useState(ultimoMes);
  const primero = dias[0]?.fecha.slice(0, 7) ?? mes;
  if (!dias.some((d) => d.noche)) return <Vacio>El calendario se llena con cada noche que registre el anillo.</Vacio>;
  return (
    <div>
      <div className="flex items-center justify-between">
        <button className="rounded-full px-2 text-sm disabled:opacity-30" style={{ color: "var(--text-secondary)" }} disabled={mes <= primero} onClick={() => setMes(desplazarMes(mes, -1))} aria-label="Mes anterior">
          ‹
        </button>
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {tituloMes(mes)}
        </span>
        <button className="rounded-full px-2 text-sm disabled:opacity-30" style={{ color: "var(--text-secondary)" }} disabled={mes >= ultimoMes} onClick={() => setMes(desplazarMes(mes, 1))} aria-label="Mes siguiente">
          ›
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
        {DIAS_SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {semanasDelMes(mes).flat().map((fecha, i) => {
          const d = fecha ? porFecha.get(fecha) : undefined;
          const ef = d?.noche?.efficiency;
          const min = minutosDormido(d?.noche);
          if (!fecha) return <span key={`h${i}`} />;
          return (
            <button
              key={fecha}
              disabled={!d?.noche}
              onClick={() => onSeleccionar(fecha)}
              className="flex h-14 flex-col items-start rounded-md p-1 text-left text-[11px] sm:h-16"
              style={{
                background: ef != null ? colorEficiencia(ef) : "var(--page-plane)",
                border: `${seleccion === fecha ? 2 : 1}px solid ${seleccion === fecha ? "var(--marca)" : "var(--border)"}`,
                color: "var(--text-primary)",
                cursor: d?.noche ? "pointer" : "default",
              }}
              title={d?.noche ? `${fecha}: ${min != null ? horasMin(min) : "—"} dormido, eficiencia ${ef ?? "—"}%` : fecha}
            >
              <span style={{ color: "var(--text-muted)" }}>{Number(fecha.slice(8))}</span>
              {min != null && <span className="mt-auto font-medium tabular-nums">{(min / 60).toFixed(1)} h</span>}
              {ef != null && <span className="hidden tabular-nums sm:inline" style={{ color: "var(--text-secondary)" }}>{Math.round(ef)}%</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Color por eficiencia (rojo = baja, verde = alta). Toca una noche para ver sus fases arriba.
      </p>
    </div>
  );
}

// ---------------------------------------------------------- 9. actividad

export function ActividadDiaria({ dias }: { dias: readonly DiaSalud[] }) {
  const datos = useMemo(
    () =>
      dias
        .filter((d) => d.actividad)
        .map((d) => ({ fecha: d.fecha, pasos: d.actividad?.steps ?? null, kcal: d.actividad?.active_kcal ?? null, km: d.actividad?.distance_m != null ? d.actividad.distance_m / 1000 : null })),
    [dias]
  );
  if (!datos.length) return <Vacio>Aún no hay actividad registrada.</Vacio>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <BarrasSimples titulo="Pasos" datos={datos} clave="pasos" color="var(--series-3)" formato={(v) => Math.round(v).toLocaleString("es-MX")} />
      <BarrasSimples titulo="Calorías activas (kcal)" datos={datos} clave="kcal" color="var(--series-2)" formato={(v) => `${Math.round(v)} kcal`} />
    </div>
  );
}

interface FilaActividad {
  fecha: string;
  pasos: number | null;
  kcal: number | null;
}

function BarrasSimples({ titulo, datos, clave, color, formato }: { titulo: string; datos: FilaActividad[]; clave: "pasos" | "kcal"; color: string; formato: (v: number) => string }) {
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {titulo}
      </p>
      <div className="mt-1 h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="fecha" tickFormatter={fechaCorta} tick={EJE} axisLine={false} tickLine={false} />
            <YAxis tick={EJE} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${v}`)} />
            <Tooltip
              cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <Caja titulo={fechaCorta((payload[0].payload as FilaActividad).fecha)} lineas={[payload[0].value == null ? "Sin dato" : formato(Number(payload[0].value))]} />
                ) : null
              }
            />
            <Bar dataKey={clave} fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ----------------------------------- 10. HR a lo largo del día (día × hora)

export function HRDelDia({ dias }: { dias: readonly DiaSalud[] }) {
  const celdas = useMemo(() => celdasHR(dias), [dias]);
  const fechas = useMemo(() => [...new Set(celdas.map((c) => c.fecha))].sort().reverse().slice(0, 14), [celdas]);
  const [elegida, setElegida] = useState<string | null>(null);
  if (!celdas.length) return <Vacio>Aún no hay ritmo cardiaco por hora.</Vacio>;
  const min = Math.min(...celdas.map((c) => c.mediana));
  const max = Math.max(...celdas.map((c) => c.mediana));
  const intensidad = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  const porClave = new Map(celdas.map((c) => [`${c.fecha}|${c.hora}`, c.mediana]));
  const fechaLinea = elegida ?? fechas[0];
  const linea = Array.from({ length: 24 }, (_, hora) => ({ hora, mediana: porClave.get(`${fechaLinea}|${hora}`) ?? null }));
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Mediana por hora del día {fechaCorta(fechaLinea)}
      </p>
      <div className="mt-1 h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={linea} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="hora" tickFormatter={(h) => `${h}h`} tick={EJE} axisLine={false} tickLine={false} interval={2} />
            <YAxis domain={["auto", "auto"]} tick={EJE} axisLine={false} tickLine={false} />
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length && payload[0].value != null ? (
                  <Caja titulo={`${(payload[0].payload as { hora: number }).hora}:00`} lineas={[`${payload[0].value} lpm`]} />
                ) : null
              }
            />
            <Line dataKey="mediana" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 3, fill: "var(--series-2)", stroke: "var(--surface-1)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        Mapa de calor: día × hora (más oscuro = más alto). Toca un día para verlo arriba.
      </p>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full border-separate text-[10px]" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="font-normal" style={{ color: "var(--text-muted)" }}>
                  {h % 3 === 0 ? h : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fechas.map((f) => (
              <tr key={f}>
                <th className="pr-1 text-left font-normal">
                  <button onClick={() => setElegida(f)} style={{ color: f === fechaLinea ? "var(--marca)" : "var(--text-secondary)" }}>
                    {fechaCorta(f)}
                  </button>
                </th>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = porClave.get(`${f}|${h}`);
                  return (
                    <td
                      key={h}
                      title={v == null ? `${f} ${h}:00 sin dato` : `${f} ${h}:00 · ${v} lpm`}
                      className="h-4 min-w-3 rounded-sm"
                      style={{
                        background: v == null ? "var(--page-plane)" : `color-mix(in srgb, var(--series-2) ${Math.round(15 + 85 * intensidad(v))}%, var(--surface-1))`,
                      }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------- 11. cruce Salud × Finanzas

export function CruceSuenoGasto({ dias, gasto }: { dias: readonly DiaSalud[]; gasto: ReadonlyMap<string, number> | null }) {
  const puntos = useMemo(() => (gasto ? cruceSuenoGasto(dias, gasto) : []), [dias, gasto]);
  if (!gasto) return <Vacio>Cargando gastos…</Vacio>;
  if (puntos.length < 2)
    return <Vacio>Se necesitan al menos 2 noches para cruzar sueño y gasto ({puntos.length} hasta hoy).</Vacio>;
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--gridline)" />
          <XAxis dataKey="horas" type="number" name="Horas dormidas" domain={["auto", "auto"]} tickFormatter={(h) => `${Number(h).toFixed(1)} h`} tick={EJE} axisLine={false} tickLine={false} />
          <YAxis dataKey="gasto" type="number" name="Gasto" tickFormatter={(v) => moneda.format(v).replace(/\.00$/, "")} tick={EJE} axisLine={false} tickLine={false} width={72} />
          <ZAxis range={[64, 64]} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof puntos)[number];
              return <Caja titulo={fechaCorta(p.fecha)} lineas={[`Dormiste ${p.horas} h`, `Gastaste ${moneda.format(p.gasto)}`]} />;
            }}
          />
          <Scatter data={puntos} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
