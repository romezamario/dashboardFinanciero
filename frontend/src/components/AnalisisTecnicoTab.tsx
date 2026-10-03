import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  calcularSerieTecnica,
  compararQqqTqqq,
  extremos52Semanas,
  inicioRango,
  obtenerCotizaciones,
  RANGOS_TECNICOS,
  recortar,
  sesionesDelLadoSma200,
  ultimoCruce,
  volatilidadAnualizada,
  type PuntoComparativo,
  type PuntoTecnico,
  type RangoTecnico,
  type SerieCotizaciones,
  type Simbolo,
} from "../lib/tecnico";
import { Tabla, Tile } from "./IndicadoresUI";
import { MacroEeuu } from "./MacroEeuu";

// Colores: los mismos 4 slots de la paleta categórica ya validada (dataviz).
// Velas, volumen e histograma del MACD son polaridad (sube/baja): azul/naranja,
// como el FlujoNetoChart. Las medias tienen identidad fija en toda la pestaña:
// SMA 50 = aqua, SMA 200 = amarillo.
const COLOR_SUBE = "var(--series-1)";
const COLOR_BAJA = "var(--series-2)";
const COLOR_SMA50 = "var(--series-3)";
const COLOR_SMA200 = "var(--series-4)";

const SIMBOLOS: Simbolo[] = ["QQQ", "TQQQ"];
const ANCHO_EJE = 52;

const dolares = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pct = new Intl.NumberFormat("es-MX", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const pctSinSigno = new Intl.NumberFormat("es-MX", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const compacto = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

function nombreFecha(fecha: string, conDia = true): string {
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: conDia ? "numeric" : undefined,
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const estiloTarjeta = { background: "var(--surface-1)", border: "1px solid var(--border)" };
const estiloTooltip = { ...estiloTarjeta, color: "var(--text-primary)" };

/** Pestaña "QQQ / TQQQ": análisis técnico de los dos ETFs y, aparte, los
 * indicadores macro de EE.UU. que sigue la Fed (MacroEeuu). */
export function AnalisisTecnicoTab() {
  const [seccion, setSeccion] = useState<"tecnico" | "macro">("tecnico");
  return (
    <div className="space-y-6">
      <Segmentado
        opciones={[
          { id: "tecnico", etiqueta: "Análisis técnico" },
          { id: "macro", etiqueta: "Macro EE.UU." },
        ]}
        valor={seccion}
        onCambiar={setSeccion}
      />
      {seccion === "tecnico" ? <VistaTecnica /> : <MacroEeuu />}
    </div>
  );
}

function VistaTecnica() {
  const [series, setSeries] = useState<Partial<Record<Simbolo, SerieCotizaciones>>>({});
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [simbolo, setSimbolo] = useState<Simbolo>("QQQ");
  const [rango, setRango] = useState<RangoTecnico>("1A");
  const [tipo, setTipo] = useState<"velas" | "linea">("velas");
  const [capas, setCapas] = useState({ sma50: true, sma200: true, bollinger: false });

  const cargar = useCallback(async (forzar: boolean) => {
    setCargando(true);
    setError(null);
    try {
      const datos = await Promise.all(SIMBOLOS.map((s) => obtenerCotizaciones(s, forzar)));
      setSeries(Object.fromEntries(datos.map((d) => [d.simbolo, d])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar(false);
  }, [cargar]);

  const tecnicos = useMemo(() => {
    const salida: Partial<Record<Simbolo, PuntoTecnico[]>> = {};
    for (const s of SIMBOLOS) {
      const serie = series[s];
      if (serie) salida[s] = calcularSerieTecnica(serie.velas);
    }
    return salida;
  }, [series]);

  const completos = tecnicos[simbolo];
  const desde = completos?.length ? inicioRango(completos[completos.length - 1].fecha, rango) : "";
  const visibles = useMemo(
    () => (completos ? recortar(completos, desde) : []),
    [completos, desde]
  );
  const comparativo = useMemo(
    () =>
      series.QQQ && series.TQQQ ? compararQqqTqqq(series.QQQ.velas, series.TQQQ.velas, desde) : null,
    [series, desde]
  );

  // Más de ~1 año de velas diarias quedan de 1-2 px: ilegibles.
  const velasDisponibles = rango === "3M" || rango === "6M" || rango === "1A";
  const tipoEfectivo = velasDisponibles ? tipo : "linea";

  if (!completos?.length) {
    return (
      <p
        className="text-sm"
        style={{ color: error ? "var(--status-critical)" : "var(--text-secondary)" }}
      >
        {error ? `No se pudieron traer las cotizaciones: ${error}` : "Cargando cotizaciones…"}
      </p>
    );
  }

  const serie = series[simbolo]!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmentado
            opciones={SIMBOLOS.map((s) => ({ id: s, etiqueta: s }))}
            valor={simbolo}
            onCambiar={setSimbolo}
          />
          <Segmentado
            opciones={RANGOS_TECNICOS.map((r) => ({ id: r.id, etiqueta: r.id }))}
            valor={rango}
            onCambiar={setRango}
          />
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>
            {serie.nombre} · datos al{" "}
            {new Date(serie.actualizado).toLocaleString("es-MX", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
          <button
            onClick={() => void cargar(true)}
            disabled={cargando}
            className="underline disabled:opacity-50"
          >
            {cargando ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>
      {error && (
        <p className="text-xs" style={{ color: "var(--status-critical)" }}>
          No se pudo actualizar: {error} (se muestran los últimos datos descargados).
        </p>
      )}

      <Resumen puntos={completos} />

      <div className="rounded-lg p-4" style={estiloTarjeta}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Precio de {simbolo} (diario)
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Interruptor
              activo={capas.sma50}
              color={COLOR_SMA50}
              texto="SMA 50"
              onClick={() => setCapas((c) => ({ ...c, sma50: !c.sma50 }))}
            />
            <Interruptor
              activo={capas.sma200}
              color={COLOR_SMA200}
              texto="SMA 200"
              onClick={() => setCapas((c) => ({ ...c, sma200: !c.sma200 }))}
            />
            <Interruptor
              activo={capas.bollinger}
              color="var(--text-muted)"
              texto="Bollinger 20, 2"
              onClick={() => setCapas((c) => ({ ...c, bollinger: !c.bollinger }))}
            />
            <Segmentado
              opciones={[
                { id: "velas", etiqueta: "Velas", deshabilitada: !velasDisponibles },
                { id: "linea", etiqueta: "Línea" },
              ]}
              valor={tipoEfectivo}
              onCambiar={setTipo}
              chico
            />
          </div>
        </div>
        <GraficaPrecio puntos={visibles} tipo={tipoEfectivo} capas={capas} />
        <GraficaVolumen puntos={visibles} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <GraficaRsi puntos={visibles} />
        <GraficaMacd puntos={visibles} />
      </div>

      <LecturaTecnica simbolo={simbolo} puntos={completos} qqq={tecnicos.QQQ} />

      {comparativo && (
        <Comparativo puntos={comparativo.puntos} resumen={comparativo.resumen} desde={desde} />
      )}

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Lecturas mecánicas de indicadores sobre precios diarios de Yahoo Finance (pueden tener
        retraso). Son información, no recomendaciones de inversión.
      </p>
    </div>
  );
}

// ------------------------------------------------------------- controles

function Segmentado<T extends string>({
  opciones,
  valor,
  onCambiar,
  chico = false,
}: {
  opciones: { id: T; etiqueta: string; deshabilitada?: boolean }[];
  valor: T;
  onCambiar: (valor: T) => void;
  chico?: boolean;
}) {
  return (
    <div
      className="inline-flex rounded-md p-0.5"
      style={{ background: "var(--page-plane)", border: "1px solid var(--border)" }}
    >
      {opciones.map((o) => (
        <button
          key={o.id}
          onClick={() => onCambiar(o.id)}
          disabled={o.deshabilitada}
          title={o.deshabilitada ? "Disponible hasta 1 año de rango" : undefined}
          className={`rounded ${chico ? "px-2 py-0.5" : "px-3 py-1"} text-xs font-medium disabled:opacity-40`}
          style={{
            background: valor === o.id ? "var(--surface-1)" : "transparent",
            color: valor === o.id ? "var(--text-primary)" : "var(--text-secondary)",
            boxShadow: valor === o.id ? "0 0 0 1px var(--border)" : undefined,
          }}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

function Interruptor({
  activo,
  color,
  texto,
  onClick,
}: {
  activo: boolean;
  color: string;
  texto: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activo}
      className="flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{
        border: "1px solid var(--border)",
        color: activo ? "var(--text-primary)" : "var(--text-muted)",
        opacity: activo ? 1 : 0.6,
      }}
    >
      <span className="inline-block h-0.5 w-3" style={{ background: color }} />
      {texto}
    </button>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-0.5 w-3" style={{ background: color }} />
      {texto}
    </span>
  );
}

// ---------------------------------------------------------------- resumen

function Resumen({ puntos }: { puntos: PuntoTecnico[] }) {
  const ultimo = puntos[puntos.length - 1];
  const { maximo, minimo } = extremos52Semanas(puntos);
  const vol = volatilidadAnualizada(puntos.map((p) => p.cierre));
  const distanciaSma200 = ultimo.sma200 == null ? null : ultimo.cierre / ultimo.sma200 - 1;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Tile
        etiqueta={`Cierre ${nombreFecha(ultimo.fecha)}`}
        valor={dolares.format(ultimo.cierre)}
        delta={
          ultimo.cambio == null
            ? undefined
            : {
                texto: `${pct.format(ultimo.cambio)} en el día`,
                sube: ultimo.cambio >= 0,
                favorable: ultimo.cambio >= 0,
              }
        }
      />
      <Tile
        etiqueta="RSI 14"
        valor={ultimo.rsi == null ? "—" : decimal.format(ultimo.rsi)}
        detalle={ultimo.rsi == null ? undefined : zonaRsi(ultimo.rsi)}
      />
      <Tile
        etiqueta="Distancia a SMA 200"
        valor={distanciaSma200 == null ? "—" : pct.format(distanciaSma200)}
        detalle={distanciaSma200 == null ? undefined : distanciaSma200 >= 0 ? "Por encima" : "Por debajo"}
      />
      <Tile
        etiqueta="Desde máximo 52 sem."
        valor={pct.format(ultimo.cierre / maximo - 1)}
        detalle={`Máx ${dolares.format(maximo)} · mín ${dolares.format(minimo)}`}
      />
      <Tile
        etiqueta="ATR 14"
        valor={ultimo.atr == null ? "—" : dolares.format(ultimo.atr)}
        detalle={ultimo.atr == null ? undefined : `${pctSinSigno.format(ultimo.atr / ultimo.cierre)} del precio`}
      />
      <Tile
        etiqueta="Volatilidad 20 días"
        valor={vol == null ? "—" : pctSinSigno.format(vol)}
        detalle="Anualizada"
      />
    </div>
  );
}

function zonaRsi(valor: number): string {
  if (valor >= 70) return "Sobrecompra (≥ 70)";
  if (valor <= 30) return "Sobreventa (≤ 30)";
  return "Zona neutral";
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

function GraficaPrecio({
  puntos,
  tipo,
  capas,
}: {
  puntos: PuntoTecnico[];
  tipo: "velas" | "linea";
  capas: { sma50: boolean; sma200: boolean; bollinger: boolean };
}) {
  const esMovil = useEsMovil();
  return (
    <div className={`mt-3 ${esMovil ? "h-64" : "h-80"}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={puntos} syncId="tecnico" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--gridline)" />
          {ejeX(puntos, false)}
          <YAxis
            orientation="right"
            width={ANCHO_EJE}
            domain={[(min: number) => min * 0.98, (max: number) => max * 1.02]}
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
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function GraficaVolumen({ puntos }: { puntos: PuntoTecnico[] }) {
  return (
    <div className="mt-1 h-24">
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
                    Volumen {compacto.format(p.volumen)}
                    {p.volumenPromedio20 != null &&
                      ` · ${decimal.format(p.volumen / p.volumenPromedio20)}× su promedio de 20 días`}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="volumen" isAnimationActive={false}>
            {puntos.map((p) => (
              <Cell
                key={p.fecha}
                fill={p.cierre >= p.apertura ? COLOR_SUBE : COLOR_BAJA}
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
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function GraficaRsi({ puntos }: { puntos: PuntoTecnico[] }) {
  return (
    <div className="rounded-lg p-4" style={estiloTarjeta}>
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

function GraficaMacd({ puntos }: { puntos: PuntoTecnico[] }) {
  return (
    <div className="rounded-lg p-4" style={estiloTarjeta}>
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

function textoCruce(cruce: ReturnType<typeof ultimoCruce>, alcista: string, bajista: string): string {
  if (!cruce) return "Sin cruce en los datos";
  return `${cruce.alcista ? alcista : bajista} el ${nombreFecha(cruce.fecha)}`;
}

function LecturaTecnica({
  simbolo,
  puntos,
  qqq,
}: {
  simbolo: Simbolo;
  puntos: PuntoTecnico[];
  qqq: PuntoTecnico[] | undefined;
}) {
  const u = puntos[puntos.length - 1];
  const filas: React.ReactNode[][] = [];

  if (u.sma200 != null) {
    const arriba = u.cierre > u.sma200;
    filas.push([
      "Tendencia de largo plazo",
      `${pct.format(u.cierre / u.sma200 - 1)} vs SMA 200`,
      `${arriba ? "Sobre" : "Bajo"} la SMA 200 desde hace ${sesionesDelLadoSma200(puntos)} sesiones`,
    ]);
  }
  if (u.sma50 != null && u.sma200 != null) {
    filas.push([
      "SMA 50 vs SMA 200",
      u.sma50 > u.sma200 ? "50 sobre 200" : "50 bajo 200",
      textoCruce(
        ultimoCruce(puntos, (p) => p.sma50, (p) => p.sma200),
        "Cruce dorado",
        "Cruce de la muerte"
      ),
    ]);
  }
  if (u.rsi != null) filas.push(["RSI 14", decimal.format(u.rsi), zonaRsi(u.rsi)]);
  if (u.macd != null && u.senal != null) {
    filas.push([
      "MACD",
      `${decimal.format(u.macd)} vs señal ${decimal.format(u.senal)}`,
      `${u.macd > u.senal ? "Sobre" : "Bajo"} la señal · ${textoCruce(
        ultimoCruce(puntos, (p) => p.macd, (p) => p.senal),
        "cruzó al alza",
        "cruzó a la baja"
      )}`,
    ]);
  }
  if (u.bbSuperior != null && u.bbInferior != null && u.bbMedia != null) {
    const b = (u.cierre - u.bbInferior) / (u.bbSuperior - u.bbInferior);
    const ancho = (u.bbSuperior - u.bbInferior) / u.bbMedia;
    filas.push([
      "Bollinger %B",
      decimal.format(b),
      `${
        b > 1
          ? "Por encima de la banda superior"
          : b < 0
            ? "Por debajo de la banda inferior"
            : b >= 0.8
              ? "Cerca de la banda superior"
              : b <= 0.2
                ? "Cerca de la banda inferior"
                : "Dentro de las bandas"
      } · ancho ${pctSinSigno.format(ancho)}`,
    ]);
  }
  if (u.volumenPromedio20 != null) {
    filas.push([
      "Volumen",
      compacto.format(u.volumen),
      `${decimal.format(u.volumen / u.volumenPromedio20)}× su promedio de 20 días`,
    ]);
  }
  // Mucha gente usa la tendencia de QQQ (no la de TQQQ, más ruidosa) como
  // referencia para TQQQ: se muestra como dato, sin convertirlo en señal.
  const uq = qqq?.[qqq.length - 1];
  if (simbolo === "TQQQ" && uq?.sma200 != null) {
    filas.push([
      "Referencia: QQQ vs su SMA 200",
      pct.format(uq.cierre / uq.sma200 - 1),
      `QQQ ${uq.cierre > uq.sma200 ? "sobre" : "bajo"} su SMA 200 desde hace ${sesionesDelLadoSma200(qqq!)} sesiones`,
    ]);
  }

  return (
    <Tabla
      titulo={`Lectura técnica de ${simbolo} al ${nombreFecha(u.fecha)}`}
      vacio="Sin datos suficientes."
      encabezados={["Indicador", "Valor", "Lectura"]}
      filas={filas}
    />
  );
}

// ------------------------------------------------------------ comparativo

function Comparativo({
  puntos,
  resumen,
  desde,
}: {
  puntos: PuntoComparativo[];
  resumen: NonNullable<ReturnType<typeof compararQqqTqqq>>["resumen"];
  desde: string;
}) {
  const ultimo = puntos[puntos.length - 1];
  const efecto = resumen.rendimientoTqqq - resumen.tresVecesQqq;
  const porc = (v: number | null) => (v == null ? "—" : pctSinSigno.format(v));
  return (
    <div className="space-y-6">
      <Tabla
        titulo={`Apalancamiento en el rango (desde ${nombreFecha(desde)}, ${puntos.length} sesiones)`}
        vacio="Sin datos."
        encabezados={["Métrica", "QQQ", "TQQQ"]}
        filas={[
          ["Rendimiento", pct.format(resumen.rendimientoQqq), pct.format(resumen.rendimientoTqqq)],
          [
            "3 × rendimiento de QQQ",
            "—",
            `${pct.format(resumen.tresVecesQqq)} · TQQQ quedó ${puntosPct(efecto)}`,
          ],
          [
            "Beta diaria vs QQQ",
            "1",
            resumen.beta == null ? "—" : decimal.format(resumen.beta),
          ],
          ["Volatilidad anualizada", porc(resumen.volatilidadQqq), porc(resumen.volatilidadTqqq)],
          [
            "Peor caída en el rango",
            pctSinSigno.format(resumen.maxDrawdownQqq),
            pctSinSigno.format(resumen.maxDrawdownTqqq),
          ],
          ["Caída actual desde el máximo", pctSinSigno.format(ultimo.ddQqq), pctSinSigno.format(ultimo.ddTqqq)],
        ]}
      />
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        TQQQ busca 3× el movimiento <em>diario</em> de su índice, no 3× el de un periodo: al
        capitalizarse cada día, en rangos volátiles o laterales queda por debajo de 3× (y en
        tendencias limpias puede quedar arriba). Esa diferencia es la de la fila "3 × rendimiento de QQQ". La beta
        tampoco da 3 exacto: comisiones, costo de financiamiento y el rebalanceo de cierre la
        mueven un poco.
      </p>
    </div>
  );
}

/** Diferencia entre dos rendimientos en puntos porcentuales ("-18.6 pts"). */
function puntosPct(diferencia: number): string {
  const pts = decimal.format(Math.abs(diferencia * 100));
  return `${diferencia >= 0 ? "+" : "−"}${pts} pts ${diferencia >= 0 ? "arriba" : "abajo"}`;
}
