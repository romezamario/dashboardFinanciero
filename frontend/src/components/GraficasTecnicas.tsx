// Gráficas de la pestaña QQQ / TQQQ (precio con velas y niveles, volumen,
// RSI y MACD), separadas de AnalisisTecnicoTab.tsx para que cada archivo se
// pueda leer completo. Comparten eje X (syncId) y los colores de abajo.

import { useMemo } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEsMovil } from "../hooks/useEsMovil";
import { CONFIG_DETECCION, type Patron } from "../lib/patrones";
import {
  nombreFecha,
  SESIONES_NIVELES,
  zonaRsi,
  type NivelTecnico,
  type PuntoTecnico,
} from "../lib/tecnico";
import { elementosDePatrones, type EventosPatron } from "./dibujoPatrones";
import { Tabla } from "./IndicadoresUI";
import {
  compacto,
  decimal as decimal1,
  decimal2 as decimal,
  dolares,
  entero,
  porcentajeConSigno1 as pct,
} from "../lib/formato";
import { estiloTooltip } from "../lib/estilos";

// Colores: los mismos 4 slots de la paleta categórica ya validada (dataviz).
// Velas, volumen e histograma del MACD son polaridad (sube/baja): azul/naranja,
// como el FlujoNetoChart. Las medias tienen identidad fija en toda la pestaña:
// SMA 50 = aqua, SMA 200 = amarillo.
const COLOR_SUBE = "var(--series-1)";
const COLOR_BAJA = "var(--series-2)";
export const COLOR_SMA50 = "var(--series-3)";
export const COLOR_SMA200 = "var(--series-4)";
// Soportes en verde y resistencias en rojo, como se acostumbra en trading;
// cada línea lleva su nombre escrito, así que el color nunca va solo.
export const COLOR_RESISTENCIA = "var(--status-critical)";
const COLOR_SOPORTE = "var(--status-good)";

const ANCHO_EJE = 52;

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-0.5 w-3" style={{ background: color }} />
      {texto}
    </span>
  );
}

// ---------------------------------------------------------------- gráficas

function ejeX(puntos: { fecha: string }[], visible = true) {
  // Un rango corto muestra día; uno largo, solo mes y año.
  const conDia = puntos.length <= 130;
  return (
    <XAxis
      dataKey="fecha"
      hide={!visible}
      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
      axisLine={false}
      tickLine={false}
      minTickGap={40}
      tickFormatter={(f: string) =>
        conDia
          ? new Date(`${f}T12:00:00Z`).toLocaleDateString("es-MX", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })
          : nombreFecha(f, false)
      }
    />
  );
}

interface FormaVela {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: PuntoTecnico;
}

/** La barra recibe el rango [mínimo, máximo] (y/height en píxeles); de ahí se
 * interpolan apertura y cierre para dibujar el cuerpo sobre la mecha. */
function Vela({ x = 0, y = 0, width = 0, height = 0, payload }: FormaVela) {
  if (!payload) return null;
  const { apertura, cierre, maximo, minimo } = payload;
  const rango = maximo - minimo;
  const aPixel = (v: number) => (rango === 0 ? y : y + ((maximo - v) / rango) * height);
  const color = cierre >= apertura ? COLOR_SUBE : COLOR_BAJA;
  const centro = x + width / 2;
  const arriba = aPixel(Math.max(apertura, cierre));
  const cuerpo = Math.max(1, aPixel(Math.min(apertura, cierre)) - arriba);
  const anchoCuerpo = Math.max(1, width * 0.7);
  return (
    <g>
      <line x1={centro} x2={centro} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect
        x={centro - anchoCuerpo / 2}
        y={arriba}
        width={anchoCuerpo}
        height={cuerpo}
        fill={color}
        rx={anchoCuerpo > 4 ? 1 : 0}
      />
    </g>
  );
}

const MARGEN_SUPERIOR_PRECIO = 8;
/** Columna a la derecha de la gráfica con el nombre de cada nivel. */
const ANCHO_ETIQUETAS = 176;
/** Separación mínima entre etiquetas (dos renglones de texto). */
const ALTO_ETIQUETA = 30;

function colorNivel(n: NivelTecnico): string {
  if (n.origen === "sma50") return COLOR_SMA50;
  if (n.origen === "sma200") return COLOR_SMA200;
  return n.tipo === "resistencia" ? COLOR_RESISTENCIA : COLOR_SOPORTE;
}

/** "~765–770" (sin decimales en QQQ; con uno en TQQQ, que vale ~80). */
function textoRango(n: NivelTecnico): string {
  const f = n.valor >= 200 ? entero : decimal1;
  const [a, b] = [f.format(n.desde), f.format(n.hasta)];
  return a === b ? `~${a}` : `~${a}–${b}`;
}

/** Reparte las etiquetas para que no se encimen: cada una baja lo necesario
 * respecto a la anterior y, si la última se sale por abajo, se empujan hacia
 * arriba. `ys` viene ordenado de arriba a abajo. */
function separarEtiquetas(ys: number[], alto: number): number[] {
  const salida = [...ys];
  for (let i = 1; i < salida.length; i++) salida[i] = Math.max(salida[i], salida[i - 1] + ALTO_ETIQUETA);
  const limite = alto - ALTO_ETIQUETA / 2;
  for (let i = salida.length - 1; i >= 0; i--) {
    const tope = i === salida.length - 1 ? limite : salida[i + 1] - ALTO_ETIQUETA;
    salida[i] = Math.min(salida[i], tope);
  }
  return salida;
}

interface EventosNivel {
  alEntrar: (nivel: NivelTecnico, e: { clientX: number; clientY: number }) => void;
  alSalir: () => void;
  alHacerClic: (nivel: NivelTecnico, e: { clientX: number; clientY: number }) => void;
}

export function GraficaPrecio({
  puntos,
  tipo,
  capas,
  niveles: todosLosNiveles,
  patrones,
  eventosPatron,
  eventosNivel,
  resaltadoId,
}: {
  puntos: PuntoTecnico[];
  tipo: "velas" | "linea";
  capas: { sma50: boolean; sma200: boolean; bollinger: boolean };
  niveles: NivelTecnico[];
  /** Patrones activos a dibujar sobre el precio. */
  patrones: Patron[];
  eventosPatron: EventosPatron;
  eventosNivel: EventosNivel;
  resaltadoId: string | null;
}) {
  const esMovil = useEsMovil();
  const alto = esMovil ? 256 : 320;
  // Dominio del eje calculado aquí (y no por Recharts) para poder ubicar las
  // etiquetas de los niveles en la misma escala que sus líneas. Solo se
  // dibujan los niveles que caen en el rango de precios visible (±3%): uno
  // lejano (en TQQQ, un soporte 25% abajo) aplastaría la gráfica; esos
  // quedan en la tabla.
  const { minimo, maximo, niveles } = useMemo(() => {
    const valores: number[] = [];
    for (const p of puntos) {
      if (tipo === "velas") valores.push(p.minimo, p.maximo);
      else valores.push(p.cierre);
      if (capas.sma50 && p.sma50 != null) valores.push(p.sma50);
      if (capas.sma200 && p.sma200 != null) valores.push(p.sma200);
      if (capas.bollinger && p.bbInferior != null) valores.push(p.bbInferior, p.bbSuperior!);
    }
    const [loPrecio, hiPrecio] = [Math.min(...valores), Math.max(...valores)];
    const visibles = todosLosNiveles.filter(
      (n) => n.valor >= loPrecio * 0.97 && n.valor <= hiPrecio * 1.03
    );
    for (const n of visibles) valores.push(n.desde, n.hasta);
    // Los patrones activos tienen que verse enteros (puntos, zonas, necklines,
    // llaves); su objetivo solo si no está lejísimos (si no, aplastaría la
    // gráfica: queda en la tarjeta del patrón).
    const cercaDeLaVista = (v: number) => {
      const margen = (hiPrecio - loPrecio) * 0.25;
      return v >= loPrecio - margen && v <= hiPrecio + margen;
    };
    for (const pa of patrones) {
      for (const pt of pa.puntos) valores.push(pt.precio);
      for (const z of pa.zonas) valores.push(z.minimo, z.maximo);
      for (const sg of pa.segmentos) {
        if (sg.estilo === "objetivo" && !cercaDeLaVista(sg.desde.precio)) continue;
        valores.push(sg.desde.precio, sg.hasta.precio);
      }
    }
    const [lo, hi] = [Math.min(...valores), Math.max(...valores)];
    const holgura = (hi - lo || 1) * 0.04;
    return { minimo: lo - holgura, maximo: hi + holgura, niveles: visibles };
  }, [puntos, tipo, capas, todosLosNiveles, patrones]);
  const aPixel = (v: number) =>
    MARGEN_SUPERIOR_PRECIO + ((maximo - v) / (maximo - minimo)) * (alto - MARGEN_SUPERIOR_PRECIO);
  const posiciones = separarEtiquetas(
    niveles.map((n) => aPixel(n.valor)),
    alto
  );
  // En el teléfono no cabe la columna: las líneas se quedan y los nombres
  // van en la tabla de abajo.
  // Con `todosLosNiveles` (no los visibles) para que la columna exista igual
  // que el espacio que reserva la gráfica de volumen y queden alineadas.
  const conEtiquetas = !esMovil && todosLosNiveles.length > 0;

  return (
    <div className="mt-3 flex">
      <div className="min-w-0 flex-1" style={{ height: alto }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={puntos}
            syncId="tecnico"
            margin={{ top: MARGEN_SUPERIOR_PRECIO, right: 0, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            {ejeX(puntos, false)}
            <YAxis
              orientation="right"
              width={ANCHO_EJE}
              type="number"
              domain={[minimo, maximo]}
              allowDataOverflow
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => decimal.format(Math.round(v))}
            />
            <Tooltip
              cursor={{ stroke: "var(--baseline)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as PuntoTecnico;
                return (
                  <div className="rounded-lg px-3 py-2 text-xs" style={estiloTooltip}>
                    <div className="font-medium">{nombreFecha(p.fecha)}</div>
                    <div style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                      <div>
                        A {decimal.format(p.apertura)} · Máx {decimal.format(p.maximo)} · Mín{" "}
                        {decimal.format(p.minimo)}
                      </div>
                      <div style={{ color: "var(--text-primary)" }}>
                        Cierre {dolares.format(p.cierre)}
                        {p.cambio != null && ` (${pct.format(p.cambio)})`}
                      </div>
                      {p.sma50 != null && <div>SMA 50: {decimal.format(p.sma50)}</div>}
                      {p.sma200 != null && <div>SMA 200: {decimal.format(p.sma200)}</div>}
                      {capas.bollinger && p.bbSuperior != null && (
                        <div>
                          Bollinger: {decimal.format(p.bbInferior!)} – {decimal.format(p.bbSuperior)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            {capas.bollinger && (
              <Area
                dataKey={(p: PuntoTecnico) =>
                  p.bbInferior == null ? null : [p.bbInferior, p.bbSuperior]
                }
                stroke="none"
                fill="var(--text-muted)"
                fillOpacity={0.15}
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            {capas.bollinger && (
              <Line
                dataKey="bbMedia"
                stroke="var(--text-muted)"
                strokeWidth={1}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            {tipo === "velas" ? (
              <Bar
                dataKey={(p: PuntoTecnico) => [p.minimo, p.maximo]}
                shape={(props: unknown) => <Vela {...(props as FormaVela)} />}
                isAnimationActive={false}
              />
            ) : (
              <Line
                dataKey="cierre"
                stroke={COLOR_SUBE}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {capas.sma50 && (
              <Line
                dataKey="sma50"
                stroke={COLOR_SMA50}
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            {capas.sma200 && (
              <Line
                dataKey="sma200"
                stroke={COLOR_SMA200}
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            {/* Los niveles de una media ya se ven en su línea; solo se trazan
             * punteados si esa media está apagada. */}
            {niveles
              .filter(
                (n) =>
                  (n.origen !== "sma50" || !capas.sma50) && (n.origen !== "sma200" || !capas.sma200)
              )
              .map((n) => (
                <ReferenceLine
                  key={n.nombre}
                  y={n.valor}
                  stroke={colorNivel(n)}
                  strokeDasharray="5 4"
                  strokeOpacity={0.85}
                />
              ))}
            {elementosDePatrones(patrones, eventosPatron, resaltadoId, puntos.length)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {conEtiquetas && (
        <div className="relative shrink-0" style={{ width: ANCHO_ETIQUETAS, height: alto }}>
          {niveles.map((n, i) => (
            <div
              key={n.nombre}
              className="absolute left-2 right-0 flex cursor-pointer gap-1.5 text-xs leading-tight"
              style={{ top: posiciones[i] - 7 }}
              onMouseEnter={(e) => eventosNivel.alEntrar(n, e)}
              onMouseLeave={eventosNivel.alSalir}
              onClick={(e) => eventosNivel.alHacerClic(n, e)}
            >
              <span
                className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: colorNivel(n) }}
              />
              {/* "Soporte mayor · SMA 50" no cabe en un renglón: lo que va
               * después del "·" baja junto al rango. */}
              <span className="min-w-0">
                <span className="block truncate font-medium" style={{ color: "var(--text-primary)" }}>
                  {n.nombre.split(" · ")[0]}
                </span>
                <span className="block truncate" style={{ color: "var(--text-muted)" }}>
                  {[...n.nombre.split(" · ").slice(1), textoRango(n)].join(" · ")}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TablaNiveles({
  niveles,
  precio,
  onVer,
}: {
  niveles: NivelTecnico[];
  precio: number;
  onVer: (nivel: NivelTecnico) => void;
}) {
  const base = (n: NivelTecnico) => {
    const giros = n.toques > 0 ? `${n.toques} giro${n.toques === 1 ? "" : "s"} del precio en la zona` : "";
    if (n.origen === "sma50") return ["Media móvil de 50 días", giros].filter(Boolean).join(" + ");
    if (n.origen === "sma200") return ["Media móvil de 200 días", giros].filter(Boolean).join(" + ");
    if (n.origen === "maximo") return "Máximo de los últimos 6 meses (el precio está en máximos)";
    return giros;
  };
  return (
    <Tabla
      titulo={`Soportes y resistencias (últimas ${SESIONES_NIVELES} sesiones, ~6 meses)`}
      vacio="Sin niveles."
      encabezados={["Nivel", "Rango", "Distancia al cierre", "Base", "Pivotes (fechas)", ""]}
      filas={niveles.map((n) => [
        <span key="n" className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorNivel(n) }} />
          {n.nombre}
        </span>,
        textoRango(n),
        pct.format(n.valor / precio - 1),
        base(n),
        n.pivotes.length > 0
          ? [...n.pivotes]
              .sort((a, b) => a.fecha.localeCompare(b.fecha))
              .map((p) => nombreFecha(p.fecha))
              .join(" · ")
          : "—",
        <button
          key="ver"
          type="button"
          onClick={() => onVer(n)}
          className="text-xs underline"
          style={{ color: "var(--series-1)" }}
        >
          Ver velas
        </button>,
      ])}
    />
  );
}

export function GraficaVolumen({
  puntos,
  conEtiquetas,
}: {
  puntos: PuntoTecnico[];
  /** La gráfica de precio tiene la columna de etiquetas a la derecha: el
   * volumen deja el mismo espacio para que las barras queden alineadas. */
  conEtiquetas: boolean;
}) {
  const esMovil = useEsMovil();
  return (
    <div
      className="mt-1"
      style={{ paddingRight: conEtiquetas && !esMovil ? ANCHO_ETIQUETAS : 0 }}
    >
      <div className="h-24">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={puntos} syncId="tecnico" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          {ejeX(puntos)}
          <YAxis
            orientation="right"
            width={ANCHO_EJE}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickCount={3}
            tickFormatter={(v: number) => compacto.format(v)}
          />
          <Tooltip
            cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as PuntoTecnico;
              return (
                <div className="rounded-lg px-3 py-2 text-xs" style={estiloTooltip}>
                  <div className="font-medium">{nombreFecha(p.fecha)}</div>
                  <div style={{ color: "var(--text-secondary)" }}>
                    Volumen {compacto.format(p.volumen)} · cierre {p.alzaDelDia ? "≥" : "<"} cierre previo
                    {p.volumenPromedio20 != null && (
                      <div>
                        Promedio de 20 sesiones: {compacto.format(p.volumenPromedio20)}
                        {p.volumenRelativo != null && ` (${decimal.format(p.volumenRelativo)}×)`}
                      </div>
                    )}
                    {p.volumenAlto && (
                      <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                        ● Volumen alto: más de {decimal.format(CONFIG_DETECCION.volumen.umbralAlto)}× el promedio
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="volumen" isAnimationActive={false}>
            {puntos.map((p) => (
              <Cell
                key={p.fecha}
                fill={p.alzaDelDia ? COLOR_SUBE : COLOR_BAJA}
                fillOpacity={0.45}
              />
            ))}
          </Bar>
          <Line
            dataKey="volumenPromedio20"
            stroke="var(--text-muted)"
            strokeWidth={1}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          {/* Marca (punto sobre la barra) en los días de volumen alto. */}
          <Line
            dataKey={(p: PuntoTecnico) => (p.volumenAlto ? p.volumen : null)}
            stroke="none"
            dot={{ r: 3, fill: "var(--text-primary)", stroke: "var(--surface-1)", strokeWidth: 1 }}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]"
        style={{ color: "var(--text-muted)" }}
      >
        <span><span style={{ color: COLOR_SUBE }}>■</span> cierre ≥ cierre previo</span>
        <span><span style={{ color: COLOR_BAJA }}>■</span> cierre &lt; cierre previo</span>
        <span>— promedio de {CONFIG_DETECCION.volumen.ventanaPromedio} sesiones</span>
        <span><span style={{ color: "var(--text-primary)" }}>●</span> volumen &gt; {decimal.format(CONFIG_DETECCION.volumen.umbralAlto)}× el promedio</span>
      </div>
    </div>
  );
}

export function GraficaRsi({ puntos }: { puntos: PuntoTecnico[] }) {
  return (
    <div className="tarjeta rounded-lg p-4">
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        RSI 14 (sobrecompra ≥ 70, sobreventa ≤ 30)
      </h3>
      <div className="mt-3 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={puntos} syncId="tecnico" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            {ejeX(puntos)}
            <YAxis
              orientation="right"
              width={ANCHO_EJE}
              domain={[0, 100]}
              ticks={[30, 50, 70]}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine y={70} stroke="var(--baseline)" strokeDasharray="4 3" />
            <ReferenceLine y={30} stroke="var(--baseline)" strokeDasharray="4 3" />
            <Tooltip
              cursor={{ stroke: "var(--baseline)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as PuntoTecnico;
                if (p.rsi == null) return null;
                return (
                  <div className="rounded-lg px-3 py-2 text-xs" style={estiloTooltip}>
                    <div className="font-medium">{nombreFecha(p.fecha)}</div>
                    <div style={{ color: "var(--text-secondary)" }}>
                      RSI {decimal.format(p.rsi)} · {zonaRsi(p.rsi)}
                    </div>
                  </div>
                );
              }}
            />
            <Line
              dataKey="rsi"
              stroke={COLOR_SUBE}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function GraficaMacd({ puntos }: { puntos: PuntoTecnico[] }) {
  return (
    <div className="tarjeta rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          MACD 12, 26, 9
        </h3>
        <div className="flex gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          <Leyenda color={COLOR_SMA50} texto="MACD" />
          <Leyenda color={COLOR_SMA200} texto="Señal" />
        </div>
      </div>
      <div className="mt-3 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={puntos} syncId="tecnico" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            {ejeX(puntos)}
            <YAxis
              orientation="right"
              width={ANCHO_EJE}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => decimal.format(v)}
            />
            <ReferenceLine y={0} stroke="var(--baseline)" />
            <Tooltip
              cursor={{ stroke: "var(--baseline)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as PuntoTecnico;
                if (p.macd == null) return null;
                return (
                  <div className="rounded-lg px-3 py-2 text-xs" style={estiloTooltip}>
                    <div className="font-medium">{nombreFecha(p.fecha)}</div>
                    <div style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                      <div>MACD {decimal.format(p.macd)}</div>
                      {p.senal != null && <div>Señal {decimal.format(p.senal)}</div>}
                      {p.histograma != null && <div>Histograma {decimal.format(p.histograma)}</div>}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="histograma" isAnimationActive={false}>
              {puntos.map((p) => (
                <Cell
                  key={p.fecha}
                  fill={(p.histograma ?? 0) >= 0 ? COLOR_SUBE : COLOR_BAJA}
                  fillOpacity={0.5}
                />
              ))}
            </Bar>
            <Line dataKey="macd" stroke={COLOR_SMA50} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="senal" stroke={COLOR_SMA200} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- lectura
