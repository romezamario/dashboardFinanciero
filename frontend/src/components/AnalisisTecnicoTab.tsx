import { useEffect, useMemo, useState } from "react";
import { detectarPatrones, FAMILIAS, type FamiliaPatron } from "../lib/patrones";
import {
  calcularNiveles,
  calcularSerieTecnica,
  compararQqqTqqq,
  extremos52Semanas,
  inicioRango,
  nombreFecha,
  obtenerCotizaciones,
  RANGOS_TECNICOS,
  recortar,
  sesionesDelLadoSma200,
  ultimoCruce,
  volatilidadAnualizada,
  zonaRsi,
  type NivelTecnico,
  type PuntoComparativo,
  type PuntoTecnico,
  type RangoTecnico,
  type SerieCotizaciones,
  type Simbolo,
} from "../lib/tecnico";
import type { EventosPatron, Seleccion } from "./dibujoPatrones";
import { Tabla, Tile } from "./IndicadoresUI";
import { MacroEeuu } from "./MacroEeuu";
import { ChipPatron, ContenidoNivel, ContenidoPatron, DetalleTrazabilidad } from "./PanelPatrones";
import { Segmentado } from "./Segmentado";
import { TarjetaFlotante } from "./TarjetaFlotante";
import {
  compacto,
  decimal2 as decimal,
  dolares,
  porcentaje1 as pctSinSigno,
  porcentajeConSigno1 as pct,
} from "../lib/formato";
import {
  COLOR_RESISTENCIA,
  COLOR_SMA200,
  COLOR_SMA50,
  GraficaMacd,
  GraficaPrecio,
  GraficaRsi,
  GraficaVolumen,
  TablaNiveles,
} from "./GraficasTecnicas";

const SIMBOLOS: Simbolo[] = ["QQQ", "TQQQ"];

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

      <div className="tarjeta rounded-lg p-4">
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
