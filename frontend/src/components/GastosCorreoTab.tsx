import { Fragment, useEffect, useMemo, useState } from "react";
import {
  agruparPorDia,
  desplazarMes,
  DIAS_HISTORIAL,
  nombreTarjeta,
  obtenerGastosCorreo,
  semanasDelMes,
  tituloDia,
  tituloMes,
  type DiaGastos,
  type GastoCorreo,
  type Sumas,
} from "../lib/gastosCorreo";

const formatoMoneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
// Para las celdas del calendario en pantallas angostas, donde no cabe el monto completo.
const formatoCompacto = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  notation: "compact",
  maximumFractionDigits: 1,
});

const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Los centavos en 0 se dejan en blanco, como en el reporte diario. */
function dinero(centavos: number | undefined): string {
  return centavos ? formatoMoneda.format(centavos / 100) : "";
}

/**
 * Pestaña "Gastos recientes": cargos de los avisos de compra de Banamex en un
 * calendario mensual. Cada día con cargos muestra lo mismo que mostraba su
 * renglón contraído (movimientos, tarjetas y total); al hacer clic se despliega,
 * justo debajo de su semana, el resumen por categoría y tarjeta y el detalle por
 * transacción con ciudad, subtotales por comercio (solo si hay más de una
 * compra) y por categoría. Los datos vienen de `gastos_correo`, aparte de
 * `transacciones`, así que no se mezclan con los estados de cuenta ni con los
 * filtros del Resumen.
 */
export function GastosCorreoTab() {
  const [gastos, setGastos] = useState<GastoCorreo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    obtenerGastosCorreo()
      .then(setGastos)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const dias = useMemo(() => (gastos ? agruparPorDia(gastos) : []), [gastos]);

  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--status-critical)" }}>
        No se pudieron cargar los gastos: {error}
      </p>
    );
  }
  if (!gastos) {
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Cargando…
      </p>
    );
  }
  if (dias.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Todavía no hay gastos de correo. Se cargan cada mañana a partir de los avisos de compra de
        Banamex.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Cargos de los avisos de compra de Banamex (últimos {DIAS_HISTORIAL} días). Elige un día
        para ver su detalle. Horas en CDMX, montos en MXN. Aparte de tus estados de cuenta: los
        cargos de aquí aún no se concilian con ellos.
      </p>
      <CalendarioGastos dias={dias} />
    </div>
  );
}

/** Mes "YYYY-MM" de una fecha ISO. */
const mesDe = (fecha: string) => fecha.slice(0, 7);

/**
 * Calendario mensual de los días con cargos. `dias` viene del más reciente al
 * más antiguo (`agruparPorDia`); al abrir, el mes y el día seleccionados son los
 * del día más reciente (igual que antes, cuando solo ese renglón estaba
 * abierto). Se navega solo entre los meses que tienen cargos.
 */
export function CalendarioGastos({ dias }: { dias: DiaGastos[] }) {
  // `undefined` = el usuario aún no elige (se usa el día más reciente);
  // `null` = cerró el detalle a propósito.
  const [seleccion, setSeleccion] = useState<string | null | undefined>(undefined);
  const [mesElegido, setMesElegido] = useState<string | null>(null);

  const porFecha = useMemo(() => new Map(dias.map((d) => [d.fecha, d])), [dias]);
  const mesMasReciente = mesDe(dias[0].fecha);
  const mesMasAntiguo = mesDe(dias[dias.length - 1].fecha);
  const mes = mesElegido ?? mesMasReciente;
  const fechaSeleccionada = seleccion === undefined ? dias[0].fecha : seleccion;
  const semanas = useMemo(() => semanasDelMes(mes), [mes]);

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
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {tituloMes(mes)}
        </h2>
        {botonMes(1, "Mes siguiente", mes >= mesMasReciente)}
      </div>

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
        const diaAbierto =
          fechaSeleccionada && semana.includes(fechaSeleccionada)
            ? porFecha.get(fechaSeleccionada)
            : undefined;
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
                    seleccionado={fecha === fechaSeleccionada}
                    onElegir={elegir}
                  />
                )
              )}
            </div>
            {diaAbierto && <PanelDia dia={diaAbierto} />}
          </Fragment>
        );
      })}
    </div>
  );
}

function CeldaDia({
  fecha,
  dia,
  seleccionado,
  onElegir,
}: {
  fecha: string;
  dia: DiaGastos | undefined;
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
  const movimientos = dia.gastos.length;
  const tarjetas = dia.tarjetas.length;
  return (
    <button
      onClick={() => onElegir(fecha)}
      aria-expanded={seleccionado}
      aria-label={`${tituloDia(fecha)}: ${movimientos} ${movimientos === 1 ? "movimiento" : "movimientos"}, ${formatoMoneda.format(dia.total.total / 100)}`}
      className="flex min-h-14 flex-col items-start justify-between rounded-md p-1.5 text-left sm:min-h-24 sm:p-2"
      style={{
        background: "var(--surface-1)",
        border: `1px solid ${seleccionado ? "var(--series-1)" : "var(--border)"}`,
        boxShadow: seleccionado ? "0 0 0 1px var(--series-1)" : undefined,
        color: "var(--text-primary)",
      }}
    >
      <span className="text-xs font-semibold sm:text-sm">{numero}</span>
      <span className="w-full">
        <span
          className="hidden text-[11px] sm:block"
          style={{ color: "var(--text-secondary)" }}
        >
          {movimientos} mov. · {tarjetas}{" "}
          {tarjetas === 1 ? "tarjeta" : "tarjetas"}
        </span>
        <span className="block truncate text-[10px] font-semibold tabular-nums sm:hidden">
          {formatoCompacto.format(dia.total.total / 100)}
        </span>
        <span className="hidden text-sm font-semibold tabular-nums sm:block">
          {formatoMoneda.format(dia.total.total / 100)}
        </span>
      </span>
    </button>
  );
}

/** El detalle de un día: el mismo encabezado del renglón de antes (fecha,
 * movimientos · tarjetas, total) y debajo las dos tablas. */
function PanelDia({ dia }: { dia: DiaGastos }) {
  return (
    <section
      className="rounded-md"
      style={{ background: "var(--surface-1)", border: "1px solid var(--series-1)" }}
    >
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {tituloDia(dia.fecha)}
        </h3>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {dia.gastos.length} {dia.gastos.length === 1 ? "movimiento" : "movimientos"} ·{" "}
          {dia.tarjetas.length} {dia.tarjetas.length === 1 ? "tarjeta" : "tarjetas"}
        </span>
        <span
          className="ml-auto text-sm font-semibold tabular-nums"
          style={{ color: "var(--text-primary)" }}
        >
          {formatoMoneda.format(dia.total.total / 100)}
        </span>
      </header>
      <div className="space-y-5 px-4 pb-4 pt-1">
        <TablaResumen dia={dia} />
        <TablaDetalle dia={dia} />
      </div>
    </section>
  );
}

const ESTILO_CABECERA = { background: "var(--text-primary)", color: "var(--page-plane)" } as const;
const ESTILO_SUBTOTAL_COMERCIO = { background: "var(--page-plane)", fontStyle: "italic" } as const;
const ESTILO_SUBTOTAL_CATEGORIA = { background: "var(--gridline)", fontWeight: 600 } as const;
const ESTILO_TOTAL = { background: "var(--text-primary)", color: "var(--page-plane)", fontWeight: 600 } as const;

function CeldasSumas({ sumas, tarjetas }: { sumas: Sumas; tarjetas: string[] }) {
  return (
    <>
      {tarjetas.map((t) => (
        <td key={t} className="px-3 py-1.5 text-right tabular-nums">
          {dinero(sumas.porTarjeta[t])}
        </td>
      ))}
      <td className="px-3 py-1.5 text-right tabular-nums">{dinero(sumas.total)}</td>
    </>
  );
}

function CabeceraTarjetas({ tarjetas }: { tarjetas: string[] }) {
  return (
    <>
      {tarjetas.map((t) => (
        <th key={t} className="px-3 py-2 text-right font-semibold">
          {nombreTarjeta(t)}
        </th>
      ))}
      <th className="px-3 py-2 text-right font-semibold">Total</th>
    </>
  );
}

function TablaResumen({ dia }: { dia: DiaGastos }) {
  return (
    <section>
      <h3
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-secondary)" }}
      >
        Resumen por categoría y tarjeta
      </h3>
      <div className="overflow-x-auto rounded" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-xs" style={{ color: "var(--text-primary)" }}>
          <thead>
            <tr style={ESTILO_CABECERA}>
              <th className="px-3 py-2 text-left font-semibold">Categoría</th>
              <CabeceraTarjetas tarjetas={dia.tarjetas} />
            </tr>
          </thead>
          <tbody>
            {dia.resumen.map((fila) => (
              <tr key={fila.categoria} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="whitespace-nowrap px-3 py-1.5">{fila.categoria}</td>
                <CeldasSumas sumas={fila.sumas} tarjetas={dia.tarjetas} />
              </tr>
            ))}
            <tr style={ESTILO_TOTAL}>
              <td className="px-3 py-1.5">Total</td>
              <CeldasSumas sumas={dia.total} tarjetas={dia.tarjetas} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TablaDetalle({ dia }: { dia: DiaGastos }) {
  return (
    <section>
      <h3
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-secondary)" }}
      >
        Detalle por transacción
      </h3>
      <div className="overflow-x-auto rounded" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-xs" style={{ color: "var(--text-primary)" }}>
          <thead>
            <tr style={ESTILO_CABECERA}>
              <th className="px-3 py-2 text-left font-semibold">Categoría</th>
              <th className="px-3 py-2 text-left font-semibold">Comercio</th>
              <th className="px-3 py-2 text-left font-semibold">Ciudad</th>
              <th className="px-3 py-2 text-left font-semibold">Hora</th>
              <CabeceraTarjetas tarjetas={dia.tarjetas} />
            </tr>
          </thead>
          <tbody>
            {dia.detalle.map((fila, i) => {
              if (fila.tipo === "gasto") {
                const g = fila.gasto;
                return (
                  <tr key={g.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="whitespace-nowrap px-3 py-1.5">{g.categoria}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{g.comercio}</td>
                    <td
                      className="whitespace-nowrap px-3 py-1.5"
                      title={g.ciudad ? undefined : "Código de ciudad sin confirmar"}
                      style={g.ciudad ? undefined : { color: "var(--text-muted)", fontSize: "0.8em" }}
                    >
                      {g.ciudad ?? g.ciudad_cod ?? ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {g.hora}
                    </td>
                    <CeldasSumas sumas={sumarUno(g, dia.tarjetas)} tarjetas={dia.tarjetas} />
                  </tr>
                );
              }
              if (fila.tipo === "comercio") {
                return (
                  <tr key={`c-${i}`} style={ESTILO_SUBTOTAL_COMERCIO}>
                    <td />
                    <td className="whitespace-nowrap px-3 py-1.5">Subtotal {fila.comercio}</td>
                    <td />
                    <td />
                    <CeldasSumas sumas={fila.sumas} tarjetas={dia.tarjetas} />
                  </tr>
                );
              }
              return (
                <tr key={`k-${i}`} style={ESTILO_SUBTOTAL_CATEGORIA}>
                  <td className="whitespace-nowrap px-3 py-1.5">{fila.categoria}</td>
                  <td className="px-3 py-1.5">Subtotal</td>
                  <td />
                  <td />
                  <CeldasSumas sumas={fila.sumas} tarjetas={dia.tarjetas} />
                </tr>
              );
            })}
            <tr style={ESTILO_TOTAL}>
              <td className="px-3 py-1.5">Total</td>
              <td />
              <td />
              <td />
              <CeldasSumas sumas={dia.total} tarjetas={dia.tarjetas} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function sumarUno(g: GastoCorreo, tarjetas: string[]): Sumas {
  const porTarjeta: Record<string, number> = {};
  for (const t of tarjetas) porTarjeta[t] = 0;
  const centavos = Math.round(g.monto * 100);
  porTarjeta[g.tarjeta] = centavos;
  return { porTarjeta, total: centavos };
}

