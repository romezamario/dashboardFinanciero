import { useMemo } from "react";
import { descargarDiaExcel } from "../lib/exportarGastosDia";
import {
  agruparPorDia,
  nombreTarjeta,
  sumarUno,
  tituloDia,
  type DiaGastos,
  type GastoCorreo,
} from "../lib/gastosCorreo";
import { type VistaCalendario, formatoMoneda, useDescargaExcel, ESTILO_CABECERA, ESTILO_SUBTOTAL_CATEGORIA, ESTILO_SUBTOTAL_COMERCIO, ESTILO_TOTAL } from "../lib/gastosUI";
import { CalendarioMensual, type ResumenDia } from "./CalendarioMensual";
import {
  CabeceraColumnas,
  CeldasSumas,
  SeccionTabla,
} from "./TablasGastosDia";

/**
 * Vista "Por correo" de "Gastos recientes": cargos de los avisos de compra de
 * Banamex en un calendario mensual. Cada día con cargos muestra lo mismo que
 * mostraba su renglón contraído (movimientos, tarjetas y total); al hacer clic
 * se despliega, justo debajo de su semana, el resumen por categoría y tarjeta y
 * el detalle por transacción con ciudad, subtotales por comercio (solo si hay
 * más de una compra) y por categoría. Los datos vienen de `gastos_correo`,
 * aparte de `transacciones`, así que no se mezclan con los estados de cuenta ni
 * con los filtros del Resumen.
 */
export function GastosCorreoTab({
  gastos,
  error,
  vista,
  onCambiarVista,
}: {
  /** null = todavía cargando (los carga `GastosRecientesTab`, una sola vez, para
   * que volver a esta vista desde "Por estado de cuenta" no vuelva a consultar). */
  gastos: GastoCorreo[] | null;
  error: string | null;
  vista: VistaCalendario;
  onCambiarVista: (cambio: (anterior: VistaCalendario) => VistaCalendario) => void;
}) {
  const dias = useMemo(() => (gastos ? agruparPorDia(gastos) : []), [gastos]);
  const resumenes = useMemo<ResumenDia[]>(
    () =>
      dias.map((d) => ({
        fecha: d.fecha,
        total: d.total.total,
        movimientos: d.gastos.length,
        fuentes: d.tarjetas.length,
      })),
    [dias]
  );
  const porFecha = useMemo(() => new Map(dias.map((d) => [d.fecha, d])), [dias]);

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
        Cargos de los avisos de compra de Banamex (todo lo que se ha cargado). Elige un día
        para ver su detalle. Horas en CDMX, montos en MXN. Aparte de tus estados de cuenta: los
        cargos de aquí aún no se concilian con ellos.
      </p>
      <CalendarioMensual
        dias={resumenes}
        etiquetaFuente={["tarjeta", "tarjetas"]}
        etiquetaTotal="gasto por día"
        vista={vista}
        onCambiarVista={onCambiarVista}
        renderPanel={(fecha) => {
          const dia = porFecha.get(fecha);
          return dia ? <PanelDia dia={dia} /> : null;
        }}
      />
    </div>
  );
}

/** El detalle de un día: el mismo encabezado del renglón de antes (fecha,
 * movimientos · tarjetas, total), el botón para bajar el día a Excel y debajo
 * las dos tablas. */
function PanelDia({ dia }: { dia: DiaGastos }) {
  const { descargando, errorExcel, descargar } = useDescargaExcel(() => descargarDiaExcel(dia));

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
        <button
          onClick={descargar}
          disabled={descargando}
          className="rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
          title={`Descarga gastos-${dia.fecha}.xlsx con el resumen, el detalle y los movimientos de este día`}
        >
          {descargando ? "Generando…" : "Descargar Excel"}
        </button>
      </header>
      {errorExcel && (
        <p className="px-4 pb-2 text-xs" style={{ color: "var(--status-critical)" }}>
          No se pudo generar el Excel: {errorExcel}
        </p>
      )}
      <div className="space-y-5 px-4 pb-4 pt-1">
        <TablaResumen dia={dia} />
        <TablaDetalle dia={dia} />
      </div>
    </section>
  );
}

function TablaResumen({ dia }: { dia: DiaGastos }) {
  return (
    <SeccionTabla titulo="Resumen por categoría y tarjeta">
      <thead>
        <tr style={ESTILO_CABECERA}>
          <th className="px-3 py-2 text-left font-semibold">Categoría</th>
          <CabeceraColumnas columnas={dia.tarjetas} nombre={nombreTarjeta} />
        </tr>
      </thead>
      <tbody>
        {dia.resumen.map((fila) => (
          <tr key={fila.categoria} style={{ borderBottom: "1px solid var(--border)" }}>
            <td className="whitespace-nowrap px-3 py-1.5">{fila.categoria}</td>
            <CeldasSumas sumas={fila.sumas} columnas={dia.tarjetas} />
          </tr>
        ))}
        <tr style={ESTILO_TOTAL}>
          <td className="px-3 py-1.5">Total</td>
          <CeldasSumas sumas={dia.total} columnas={dia.tarjetas} />
        </tr>
      </tbody>
    </SeccionTabla>
  );
}

function TablaDetalle({ dia }: { dia: DiaGastos }) {
  return (
    <SeccionTabla titulo="Detalle por transacción">
      <thead>
        <tr style={ESTILO_CABECERA}>
          <th className="px-3 py-2 text-left font-semibold">Categoría</th>
          <th className="px-3 py-2 text-left font-semibold">Comercio</th>
          <th className="px-3 py-2 text-left font-semibold">Ciudad</th>
          <th className="px-3 py-2 text-left font-semibold">Hora</th>
          <CabeceraColumnas columnas={dia.tarjetas} nombre={nombreTarjeta} />
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
                <CeldasSumas sumas={sumarUno(g, dia.tarjetas)} columnas={dia.tarjetas} />
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
                <CeldasSumas sumas={fila.sumas} columnas={dia.tarjetas} />
              </tr>
            );
          }
          return (
            <tr key={`k-${i}`} style={ESTILO_SUBTOTAL_CATEGORIA}>
              <td className="whitespace-nowrap px-3 py-1.5">{fila.categoria}</td>
              <td className="px-3 py-1.5">Subtotal</td>
              <td />
              <td />
              <CeldasSumas sumas={fila.sumas} columnas={dia.tarjetas} />
            </tr>
          );
        })}
        <tr style={ESTILO_TOTAL}>
          <td className="px-3 py-1.5">Total</td>
          <td />
          <td />
          <td />
          <CeldasSumas sumas={dia.total} columnas={dia.tarjetas} />
        </tr>
      </tbody>
    </SeccionTabla>
  );
}
