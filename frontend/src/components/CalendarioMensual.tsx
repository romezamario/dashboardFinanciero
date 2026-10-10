import { Fragment, useMemo, type ReactNode } from "react";
import {
  desplazarMes,
  posicionEnEscala,
  semanasDelMes,
  tituloDia,
  tituloMes,
} from "../lib/gastosCorreo";
import { formatoMoneda, type VistaCalendario } from "../lib/gastosUI";
import {
  META_GASTO_DIARIO,
  diasDelMes,
  resumenDeMes,
  resumenDeSemana,
  type ResumenPromedio,
} from "../lib/metaDiaria";
import { monedaCompacta as formatoCompacto } from "../lib/formato";

// Para las celdas del calendario en pantallas angostas, donde no cabe el monto completo.

const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Verde (0, poco gasto) -> amarillo -> rojo (1, mucho gasto): el tono (hue)
 * va de 120 a 0 en HSL. */
const colorCalor = (t: number) => `hsl(${Math.round(120 * (1 - t))} 75% 45%)`;
/** El color nunca va a todo color: se mezcla con el fondo de la tarjeta para
 * que el texto siga legible en modo claro y oscuro (`--surface-1` cambia con
 * el tema, la mezcla también). El monto está escrito en cada celda, así que
 * el color refuerza, no es lo único que dice cuánto se gastó. */
const FONDO_CALOR = 30;
const fondoCalor = (t: number) =>
  `color-mix(in srgb, ${colorCalor(t)} ${FONDO_CALOR}%, var(--surface-1))`;
const bordeCalor = (t: number) =>
  `color-mix(in srgb, ${colorCalor(t)} 60%, var(--border))`;

/** Una insignia en la esquina de la celda (p. ej. "Priority", "Abono"). En un
 * teléfono solo cabe un punto de color; el texto va en `title`/aria-label. */
export interface MarcaDia {
  texto: string;
  titulo: string;
  tono: "cuenta" | "abono";
}

/** Lo que la celda de un día necesita saber; el calendario no conoce de dónde
 * vienen los datos (avisos de correo o estados de cuenta). */
export interface ResumenDia {
  fecha: string;
  /** Centavos que cuentan como gasto del día; 0 = el día no suma nada (no
   * recibe color de calor). */
  total: number;
  /** Movimientos que suman al total. */
  movimientos: number;
  /** Tarjetas o cuentas distintas entre esos movimientos. */
  fuentes: number;
  /** Movimientos del día que NO suman al total (abonos, categorías ocultas). */
  sinSumar?: number;
  marcas?: MarcaDia[];
}

const COLOR_MARCA: Record<MarcaDia["tono"], string> = {
  cuenta: "var(--series-1)",
  abono: "var(--status-good)",
};

/** Mes "YYYY-MM" de una fecha ISO. */
const mesDe = (fecha: string) => fecha.slice(0, 7);

/**
 * Calendario mensual de los días con movimientos. `dias` viene del más
 * reciente al más antiguo; al abrir, el mes y el día seleccionados son los del
 * día más reciente. Se navega con ‹ › (y, si hay más de unos meses, con un
 * selector de mes). Al elegir un día, `renderPanel` dibuja su detalle justo
 * debajo de la semana de ese día.
 */
export function CalendarioMensual({
  dias,
  etiquetaFuente,
  etiquetaTotal,
  renderPanel,
  vista,
  onCambiarVista,
  fechaCorte,
}: {
  dias: ResumenDia[];
  etiquetaFuente: [singular: string, plural: string];
  etiquetaTotal: string;
  renderPanel: (fecha: string) => ReactNode;
  /** Mes y día elegidos. Viven en quien monta el calendario (no aquí) para que
   * sobrevivan al cambio entre "Por correo" y "Por estado de cuenta". */
  vista: VistaCalendario;
  onCambiarVista: (cambio: (anterior: VistaCalendario) => VistaCalendario) => void;
  /** Hasta qué día se conoce el gasto (ISO): hoy si los datos llegan casi en
   * tiempo real, la última fecha cargada si llegan con atraso. Los días de
   * una semana después de esta fecha no entran al promedio diario. */
  fechaCorte: string;
}) {
  const { seleccion, mesElegido } = vista;
  const setSeleccion = (s: string | null) => onCambiarVista((v) => ({ ...v, seleccion: s }));
  const setMesElegido = (m: string) => onCambiarVista((v) => ({ ...v, mesElegido: m }));

  const porFecha = useMemo(() => new Map(dias.map((d) => [d.fecha, d])), [dias]);
  // La escala de color usa TODOS los días cargados (no solo el mes a la vista)
  // para que un mismo monto tenga el mismo color en cualquier mes. Los días
  // que no suman nada no entran (ni reciben color).
  const extremos = useMemo(() => {
    const totales = dias.map((d) => d.total).filter((t) => t > 0);
    if (totales.length === 0) return null;
    return { minimo: Math.min(...totales), maximo: Math.max(...totales) };
  }, [dias]);
  // Gasto por día (centavos) para el promedio diario de cada semana; el primer
  // día con datos es donde empieza a contar (antes no se sabe qué se gastó).
  const totalesPorFecha = useMemo(() => new Map(dias.map((d) => [d.fecha, d.total])), [dias]);
  const primeraFecha = dias[dias.length - 1].fecha;
  const mesMasReciente = mesDe(dias[0].fecha);
  const mesMasAntiguo = mesDe(dias[dias.length - 1].fecha);
  // El mes elegido puede caer fuera de los datos de esta fuente (p. ej. un
  // estado de cuenta más antiguo que el primer aviso de correo): se acota para mostrarlo, sin borrar la elección.
  const mes =
    mesElegido === null
      ? mesMasReciente
      : mesElegido > mesMasReciente
        ? mesMasReciente
        : mesElegido < mesMasAntiguo
          ? mesMasAntiguo
          : mesElegido;
  const fechaSeleccionada = seleccion === undefined ? dias[0].fecha : seleccion;
  const semanas = useMemo(() => semanasDelMes(mes), [mes]);
  const mesesDelRango = useMemo(() => {
    const meses: string[] = [];
    for (let m = mesMasReciente; m >= mesMasAntiguo; m = desplazarMes(m, -1)) meses.push(m);
    return meses;
  }, [mesMasReciente, mesMasAntiguo]);

  function elegir(fecha: string) {
    setSeleccion(fecha === fechaSeleccionada ? null : fecha);
  }

  const botonMes = (delta: -1 | 1, etiqueta: string, deshabilitado: boolean) => (
    <button
      onClick={() => setMesElegido(desplazarMes(mes, delta))}
      disabled={deshabilitado}
      aria-label={etiqueta}
      className="rounded-md px-3 py-1 text-sm disabled:opacity-30"
      style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
    >
      {delta < 0 ? "‹" : "›"}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        {botonMes(-1, "Mes anterior", mes <= mesMasAntiguo)}
        {mesesDelRango.length > 4 ? (
          // Con años de historial ‹ › es lento: un selector salta directo.
          <select
            value={mes}
            onChange={(e) => setMesElegido(e.target.value)}
            aria-label="Mes"
            className="rounded-md px-2 py-1 text-base font-semibold"
            style={{
              background: "var(--page-plane)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          >
            {mesesDelRango.map((m) => (
              <option key={m} value={m}>
                {tituloMes(m)}
              </option>
            ))}
          </select>
        ) : (
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {tituloMes(mes)}
          </h2>
        )}
        {botonMes(1, "Mes siguiente", mes >= mesMasReciente)}
      </div>

      {extremos && (
        <LeyendaCalor minimo={extremos.minimo} maximo={extremos.maximo} etiqueta={etiquetaTotal} />
      )}
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Meta: {formatoMoneda.format(META_GASTO_DIARIO)} de gasto al día. Abajo, el promedio diario del
        mes y, debajo de cada semana (domingo a sábado), el de esa semana.
      </p>
      <FranjaPromedio
        etiqueta={tituloMes(mes)}
        diasCompletos={diasDelMes(mes).length}
        mes
        resumen={resumenDeMes(mes, totalesPorFecha, primeraFecha, fechaCorte)}
      />

      <div className="grid grid-cols-7 gap-1 sm:gap-2" aria-hidden="true">
        {DIAS_SEMANA.map((d) => (
          <div
            key={d}
            className="py-1 text-center text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            {d}
          </div>
        ))}
      </div>

      {semanas.map((semana, i) => {
        const fechaAbierta =
          fechaSeleccionada && porFecha.has(fechaSeleccionada) && semana.includes(fechaSeleccionada)
            ? fechaSeleccionada
            : null;
        return (
          <Fragment key={`${mes}-${i}`}>
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {semana.map((fecha, j) =>
                fecha === null ? (
                  <div key={`hueco-${j}`} />
                ) : (
                  <CeldaDia
                    key={fecha}
                    fecha={fecha}
                    dia={porFecha.get(fecha)}
                    extremos={extremos}
                    etiquetaFuente={etiquetaFuente}
                    seleccionado={fecha === fechaSeleccionada}
                    onElegir={elegir}
                  />
                )
              )}
            </div>
            <FranjaPromedio
              diasCompletos={7}
              resumen={resumenDeSemana(
                semana.find((f) => f !== null) ?? "",
                totalesPorFecha,
                primeraFecha,
                fechaCorte
              )}
            />
            {fechaAbierta && renderPanel(fechaAbierta)}
          </Fragment>
        );
      })}
    </div>
  );
}

const formatoDiaCorto = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const diaCorto = (fecha: string) => formatoDiaCorto.format(new Date(`${fecha}T12:00:00Z`)).replace(".", "");

/**
 * Promedio de gasto diario de una semana -- o del mes completo (`mes`) -- frente
 * a la meta (`META_GASTO_DIARIO`): una barra que se llena hasta el 100% de la
 * meta -- con una marca en la meta y desbordándose en rojo si se pasa -- y el
 * texto con el monto y la diferencia (nunca solo color). Un periodo a medias
 * (la semana o el mes en curso, o lo que sigue al último estado de cuenta)
 * promedia solo sus días conocidos y lo dice. `etiqueta` por defecto es el
 * rango de fechas contadas ("Semana 6 sep – 12 sep").
 */
function FranjaPromedio({
  resumen,
  diasCompletos,
  etiqueta,
  mes = false,
}: {
  resumen: ResumenPromedio | null;
  /** Días que tendría el periodo completo (7 o los del mes). */
  diasCompletos: number;
  etiqueta?: string;
  mes?: boolean;
}) {
  if (!resumen) return null;
  const meta = META_GASTO_DIARIO * 100; // centavos
  const sobre = resumen.promedio > meta;
  const diferencia = Math.abs(resumen.promedio - meta);
  const color = sobre ? "var(--status-critical)" : "var(--status-good)";
  // La barra llega a 100% en la meta; hasta 150% para ver cuánto se pasó.
  const proporcion = Math.min(resumen.promedio / meta, 1.5);
  const rango =
    resumen.desde === resumen.hasta
      ? diaCorto(resumen.desde)
      : `${diaCorto(resumen.desde)} – ${diaCorto(resumen.hasta)}`;
  const nombre = etiqueta ?? `Semana ${rango}`;
  const parcial = resumen.dias < diasCompletos;
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-2 text-xs"
      style={{
        background: "var(--surface-1)",
        border: `1px solid ${mes ? "var(--series-1)" : "var(--border)"}`,
      }}
      role="group"
      aria-label={`${mes ? `Mes de ${nombre}` : `Semana del ${rango}`}: promedio diario ${formatoMoneda.format(
        resumen.promedio / 100
      )}, ${sobre ? "sobre" : "dentro de"} la meta de ${formatoMoneda.format(META_GASTO_DIARIO)}`}
    >
      <span className={mes ? "font-semibold" : undefined} style={{ color: "var(--text-secondary)" }}>
        {nombre}
        {parcial && ` (${resumen.dias} ${resumen.dias === 1 ? "día" : "días"} de ${diasCompletos})`}
      </span>
      <span
        className={`font-semibold tabular-nums ${mes ? "text-sm" : ""}`}
        style={{ color: "var(--text-primary)" }}
      >
        {formatoMoneda.format(resumen.promedio / 100)} al día
      </span>
      <span
        className="relative h-2 w-28 rounded-full sm:w-44"
        style={{ background: "var(--gridline)" }}
        aria-hidden="true"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${(proporcion / 1.5) * 100}%`, background: color }}
        />
        {/* Marca de la meta (100%). */}
        <span
          className="absolute -inset-y-0.5 w-0.5"
          style={{ left: `${(1 / 1.5) * 100}%`, background: "var(--text-primary)" }}
        />
      </span>
      <span className="font-medium" style={{ color }}>
        {sobre ? "▲" : "✓"} {formatoMoneda.format(diferencia / 100)} {sobre ? "sobre" : "por debajo de"} la
        meta
      </span>
      <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
        total {formatoMoneda.format(resumen.total / 100)}
      </span>
    </div>
  );
}

/** Barra de la escala verde -> rojo, con el monto del día más barato y del más caro. */
function LeyendaCalor({
  minimo,
  maximo,
  etiqueta,
}: {
  minimo: number;
  maximo: number;
  etiqueta: string;
}) {
  const paradas = [0, 0.25, 0.5, 0.75, 1].map((t) => fondoCalor(t)).join(", ");
  return (
    <div
      className="flex items-center gap-2 text-[11px]"
      style={{ color: "var(--text-secondary)" }}
      aria-label={`Escala de color: de ${formatoMoneda.format(minimo / 100)} (verde) a ${formatoMoneda.format(maximo / 100)} (rojo) de ${etiqueta}`}
    >
      <span className="tabular-nums">{formatoMoneda.format(minimo / 100)}</span>
      <span
        aria-hidden="true"
        className="h-2.5 w-28 rounded-full sm:w-44"
        style={{
          background: `linear-gradient(to right, ${paradas})`,
          border: "1px solid var(--border)",
        }}
      />
      <span className="tabular-nums">{formatoMoneda.format(maximo / 100)}</span>
      <span>{etiqueta}</span>
    </div>
  );
}

function CeldaDia({
  fecha,
  dia,
  extremos,
  etiquetaFuente,
  seleccionado,
  onElegir,
}: {
  fecha: string;
  dia: ResumenDia | undefined;
  extremos: { minimo: number; maximo: number } | null;
  etiquetaFuente: [string, string];
  seleccionado: boolean;
  onElegir: (fecha: string) => void;
}) {
  const numero = Number(fecha.slice(8));
  if (!dia) {
    return (
      <div
        className="min-h-14 rounded-md p-1.5 text-xs sm:min-h-24 sm:p-2"
        style={{ border: "1px solid var(--gridline)", color: "var(--text-muted)" }}
      >
        {numero}
      </div>
    );
  }
  const { movimientos, fuentes, total, marcas = [], sinSumar = 0 } = dia;
  // Un día sin gasto que sume (solo pagos, abonos...) va sin color de calor.
  const calor =
    total > 0 && extremos ? posicionEnEscala(total, extremos.minimo, extremos.maximo) : null;
  const descripcionMarcas = marcas.map((m) => m.titulo).join("; ");
  return (
    <button
      onClick={() => onElegir(fecha)}
      aria-expanded={seleccionado}
      aria-label={`${tituloDia(fecha)}: ${
        total > 0
          ? `${movimientos} ${movimientos === 1 ? "movimiento" : "movimientos"}, ${formatoMoneda.format(total / 100)}`
          : "sin gasto que sume"
      }${sinSumar > 0 ? `, ${sinSumar} sin sumar` : ""}${descripcionMarcas ? `. ${descripcionMarcas}` : ""}`}
      className="flex min-h-14 flex-col items-start justify-between rounded-md p-1.5 text-left sm:min-h-24 sm:p-2"
      style={{
        background: calor === null ? "var(--surface-1)" : fondoCalor(calor),
        border: `1px solid ${
          seleccionado ? "var(--series-1)" : calor === null ? "var(--border)" : bordeCalor(calor)
        }`,
        boxShadow: seleccionado ? "0 0 0 2px var(--series-1)" : undefined,
        color: "var(--text-primary)",
      }}
    >
      <span className="flex w-full items-start justify-between gap-1">
        <span className="text-xs font-semibold sm:text-sm">{numero}</span>
        {marcas.length > 0 && (
          <span className="flex flex-wrap justify-end gap-0.5">
            {marcas.map((m) => (
              <span
                key={m.texto}
                title={m.titulo}
                className="rounded-full text-[10px] font-semibold leading-none"
                style={{ color: COLOR_MARCA[m.tono], border: `1px solid ${COLOR_MARCA[m.tono]}` }}
              >
                <span className="block h-2 w-2 sm:hidden" aria-hidden="true" />
                <span className="hidden px-1.5 py-0.5 sm:block">{m.texto}</span>
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="w-full">
        {movimientos > 0 && (
          <span
            className="hidden text-[11px] sm:block"
            style={{ color: "var(--text-secondary)" }}
          >
            {movimientos} mov. · {fuentes} {fuentes === 1 ? etiquetaFuente[0] : etiquetaFuente[1]}
          </span>
        )}
        {sinSumar > 0 && (
          <span
            className="hidden text-[10px] sm:block"
            style={{ color: "var(--text-muted)" }}
          >
            {movimientos > 0 ? "+" : ""}
            {sinSumar} sin sumar
          </span>
        )}
        {total > 0 ? (
          <>
            <span className="block truncate text-[10px] font-semibold tabular-nums sm:hidden">
              {formatoCompacto.format(total / 100)}
            </span>
            <span className="hidden text-sm font-semibold tabular-nums sm:block">
              {formatoMoneda.format(total / 100)}
            </span>
          </>
        ) : (
          <span className="block text-[10px] sm:text-xs" style={{ color: "var(--text-muted)" }}>
            sin gasto
          </span>
        )}
      </span>
    </button>
  );
}
