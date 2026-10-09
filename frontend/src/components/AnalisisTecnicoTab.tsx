import { useEffect, useMemo, useState } from "react";
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
import { CONFIG_DETECCION, detectarPatrones, FAMILIAS, type FamiliaPatron, type Patron } from "../lib/patrones";
import {
  calcularNiveles,
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
  SESIONES_NIVELES,
  type NivelTecnico,
  type PuntoComparativo,
  type PuntoTecnico,
  type RangoTecnico,
  type SerieCotizaciones,
  type Simbolo,
} from "../lib/tecnico";
import { elementosDePatrones, type EventosPatron, type Seleccion } from "./dibujoPatrones";
import { Tabla, Tile } from "./IndicadoresUI";
import { MacroEeuu } from "./MacroEeuu";
import { ChipPatron, ContenidoNivel, ContenidoPatron, DetalleTrazabilidad } from "./PanelPatrones";
import { Segmentado } from "./Segmentado";
import { TarjetaFlotante } from "./TarjetaFlotante";

// Colores: los mismos 4 slots de la paleta categórica ya validada (dataviz).
// Velas, volumen e histograma del MACD son polaridad (sube/baja): azul/naranja,
// como el FlujoNetoChart. Las medias tienen identidad fija en toda la pestaña:
// SMA 50 = aqua, SMA 200 = amarillo.
const COLOR_SUBE = "var(--series-1)";
const COLOR_BAJA = "var(--series-2)";
const COLOR_SMA50 = "var(--series-3)";
const COLOR_SMA200 = "var(--series-4)";
// Soportes en verde y resistencias en rojo, como se acostumbra en trading;
// cada línea lleva su nombre escrito, así que el color nunca va solo.
const COLOR_RESISTENCIA = "var(--status-critical)";
const COLOR_SOPORTE = "var(--status-good)";

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
  const [capas, setCapas] = useState({ sma50: true, sma200: true, bollinger: false, niveles: true });
  // Patrones chartistas: familias que se dibujan, tarjeta flotante (al pasar el
  // ratón; con un clic queda fija) y el panel con las velas que originan lo elegido.
  const [patronesActivos, setPatronesActivos] = useState<Set<FamiliaPatron>>(new Set());
  const [tarjeta, setTarjeta] = useState<{ seleccion: Seleccion; x: number; y: number; fija: boolean } | null>(null);
  const [detalle, setDetalle] = useState<Seleccion | null>(null);

  // Las velas se piden juntas; el estado se actualiza solo al terminar.
  const traer = (forzar: boolean) =>
    Promise.all(SIMBOLOS.map((s) => obtenerCotizaciones(s, forzar))).then(
      (datos) => Object.fromEntries(datos.map((d) => [d.simbolo, d])),
      (e: unknown) => {
        throw e instanceof Error ? e : new Error(String(e));
      }
    );

  function cargar(forzar: boolean) {
    setCargando(true);
    setError(null);
    traer(forzar)
      .then(setSeries, (e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }

  // Carga inicial: `cargando` ya arranca en true, así que el efecto solo
  // escribe estado cuando llega la respuesta (y no si se desmontó antes).
  useEffect(() => {
    let vigente = true;
    traer(false)
      .then(
        (datos) => vigente && setSeries(datos),
        (e: Error) => vigente && setError(e.message)
      )
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, []);

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
  // Con la serie completa (últimos ~6 meses), no con el rango visible: así
  // los niveles no cambian al hacer zoom.
  const niveles = useMemo(() => (completos ? calcularNiveles(completos) : []), [completos]);
  const comparativo = useMemo(
    () =>
      series.QQQ && series.TQQQ ? compararQqqTqqq(series.QQQ.velas, series.TQQQ.velas, desde) : null,
    [series, desde]
  );

  // Los patrones se buscan en lo que se ve (el rango elegido): al cambiar el
  // rango, cambian las detecciones. Los parámetros están en lib/patrones/config.ts.
  const patrones = useMemo(() => detectarPatrones(visibles), [visibles]);
  const patronesDibujados = useMemo(
    () => FAMILIAS.flatMap((f) => (patronesActivos.has(f.id) ? patrones[f.id] : [])),
    [patrones, patronesActivos]
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

  // Pasar el ratón abre la tarjeta (sin capturar el ratón); un clic la deja fija
  // y abre el panel de trazabilidad. Con una tarjeta fija, pasar sobre otra cosa no la cambia.
  const cerrarTarjeta = () => setTarjeta(null);
  const abrirSobre = (seleccion: Seleccion, e: { clientX: number; clientY: number }) =>
    setTarjeta((t) => (t?.fija ? t : { seleccion, x: e.clientX, y: e.clientY, fija: false }));
  const fijar = (seleccion: Seleccion, e: { clientX: number; clientY: number }) => {
    setTarjeta({ seleccion, x: e.clientX, y: e.clientY, fija: true });
    setDetalle(seleccion);
  };
  const quitarSiNoFija = () => setTarjeta((t) => (t?.fija ? t : null));
  const eventosPatron: EventosPatron = {
    alEntrar: (patron, e) => abrirSobre({ tipo: "patron", patron }, e),
    alSalir: quitarSiNoFija,
    alHacerClic: (patron, e) => fijar({ tipo: "patron", patron }, e),
  };
  const eventosNivel = {
    alEntrar: (nivel: NivelTecnico, e: { clientX: number; clientY: number }) => abrirSobre({ tipo: "nivel", nivel }, e),
    alSalir: quitarSiNoFija,
    alHacerClic: (nivel: NivelTecnico, e: { clientX: number; clientY: number }) => fijar({ tipo: "nivel", nivel }, e),
  };

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
            onClick={() => cargar(true)}
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
              activo={capas.niveles}
              color={COLOR_RESISTENCIA}
              texto="Soportes y resistencias"
              punteado
              onClick={() => setCapas((c) => ({ ...c, niveles: !c.niveles }))}
            />
            <Interruptor
              activo={capas.bollinger}
              color="var(--text-muted)"
              texto="Bollinger 20, 2"
              onClick={() => setCapas((c) => ({ ...c, bollinger: !c.bollinger }))}
            />
            <Segmentado
              opciones={[
                {
                  id: "velas",
                  etiqueta: "Velas",
                  deshabilitada: !velasDisponibles,
                  tituloDeshabilitada: "Disponible hasta 1 año de rango",
                },
                { id: "linea", etiqueta: "Línea" },
              ]}
              valor={tipoEfectivo}
              onCambiar={setTipo}
              chico
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span style={{ color: "var(--text-muted)" }}>Patrones en el rango {rango}:</span>
          {FAMILIAS.map((f) => (
            <ChipPatron
              key={f.id}
              etiqueta={f.etiqueta}
              cantidad={patrones[f.id].length}
              activo={patronesActivos.has(f.id)}
              onClick={() =>
                setPatronesActivos((previo) => {
                  const nuevo = new Set(previo);
                  if (nuevo.has(f.id)) nuevo.delete(f.id);
                  else nuevo.add(f.id);
                  return nuevo;
                })
              }
            />
          ))}
        </div>
        <GraficaPrecio
          puntos={visibles}
          tipo={tipoEfectivo}
          capas={capas}
          niveles={capas.niveles ? niveles : []}
          patrones={patronesDibujados}
          eventosPatron={eventosPatron}
          eventosNivel={eventosNivel}
          resaltadoId={tarjeta?.seleccion.tipo === "patron" ? tarjeta.seleccion.patron.id : null}
        />
        <GraficaVolumen puntos={visibles} conEtiquetas={capas.niveles && niveles.length > 0} />
        <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
          Lectura técnica automática, no es una recomendación de inversión.
        </p>
      </div>

      {detalle && <DetalleTrazabilidad seleccion={detalle} onCerrar={() => setDetalle(null)} />}

      {niveles.length > 0 && (
        <TablaNiveles
          niveles={niveles}
          precio={completos[completos.length - 1].cierre}
          onVer={(nivel) => setDetalle({ tipo: "nivel", nivel })}
        />
      )}

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

      {tarjeta && (
        <TarjetaFlotante
          x={tarjeta.x}
          y={tarjeta.y}
          fija={tarjeta.fija}
          ancho="w-96"
          etiqueta={tarjeta.seleccion.tipo === "patron" ? tarjeta.seleccion.patron.nombre : tarjeta.seleccion.nivel.nombre}
          onCerrar={cerrarTarjeta}
        >
          {tarjeta.seleccion.tipo === "patron" ? (
            <ContenidoPatron patron={tarjeta.seleccion.patron} conPista={!tarjeta.fija} />
          ) : (
            <ContenidoNivel nivel={tarjeta.seleccion.nivel} conPista={!tarjeta.fija} />
          )}
        </TarjetaFlotante>
      )}
    </div>
  );
}

// ------------------------------------------------------------- controles

function Interruptor({
  activo,
  color,
  texto,
  onClick,
  punteado = false,
}: {
  activo: boolean;
  color: string;
  texto: string;
  onClick: () => void;
  punteado?: boolean;
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
      <span
        className="inline-block w-3"
        style={punteado ? { borderTop: `2px dashed ${color}` } : { height: 2, background: color }}
      />
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
  const f = new Intl.NumberFormat("es-MX", { maximumFractionDigits: n.valor >= 200 ? 0 : 1 });
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

function GraficaPrecio({
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

function TablaNiveles({
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

function GraficaVolumen({
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
