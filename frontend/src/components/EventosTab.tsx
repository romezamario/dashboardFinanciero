import { useMemo, useState } from "react";
import {
  actualizarCategoriaComercioYEvento,
  agruparPorCategoria,
  agruparPorComercio,
  agruparPorEvento,
  cuentaDe,
  eventoDe,
} from "../lib/queries";
import type { Transaccion } from "../lib/types";
import { GastoPorEventoChart } from "./GastoPorEventoChart";
import { GastoPorCategoriaChart } from "./GastoPorCategoriaChart";
import { GastoPorComercioChart } from "./GastoPorComercioChart";
import { TransaccionesTabla } from "./TransaccionesTabla";

const formateadorMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const formateadorFecha = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const TOPE_RESULTADOS = 100;

interface EventosTabProps {
  transacciones: Transaccion[];
  onActualizado: () => void | Promise<void>;
}

/**
 * A diferencia de "Editar en lote" (que busca por descripción), armar un
 * evento parte de "qué pasó en tal rango de fechas, en tal cuenta/tarjeta"
 * -- no hay una palabra clave común entre un Uber, un restaurante y un
 * hotel del mismo viaje. Por eso el filtro aquí es fecha/cuenta/tarjeta en
 * vez de texto libre, y por la misma razón que el buscador de texto libre
 * (evitar listar todo por accidente), no se muestra nada hasta que al
 * menos un filtro esté activo.
 */
export function EventosTab({ transacciones, onActualizado }: EventosTabProps) {
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [tarjeta, setTarjeta] = useState("");
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [nuevoEvento, setNuevoEvento] = useState("");
  const [eventoSeleccionado, setEventoSeleccionado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(
    null
  );

  const cuentasExistentes = useMemo(
    () => Array.from(new Set(transacciones.map(cuentaDe))).sort(),
    [transacciones]
  );
  const tarjetasExistentes = useMemo(
    () =>
      Array.from(
        new Set(transacciones.map((t) => t.tarjeta).filter((t): t is string => !!t))
      ).sort(),
    [transacciones]
  );
  const eventosExistentes = useMemo(
    () =>
      Array.from(
        new Set(transacciones.map(eventoDe).filter((e): e is string => e !== null))
      ).sort(),
    [transacciones]
  );

  // Resumen de todos los eventos ya armados -- a propósito NO se calcula
  // sobre el filtro de fecha/cuenta/tarjeta de arriba (ese filtro sirve
  // para ENCONTRAR transacciones que todavía no tienen evento, no para
  // acotar este resumen de los que ya lo tienen).
  const gastoPorEvento = useMemo(() => agruparPorEvento(transacciones), [transacciones]);

  // Igual que el Resumen (categoría/comercio/tabla), pero aquí la única
  // dimensión que filtra es el evento -- clic en una barra de
  // GastoPorEventoChart aísla ese evento para las gráficas y la tabla de
  // abajo; sin selección, se ve el desglose de TODO lo que ya tiene un
  // evento asignado (no de todas las transacciones, eso ya lo muestra el
  // Resumen).
  const transaccionesConEvento = useMemo(
    () => transacciones.filter((t) => eventoDe(t) !== null),
    [transacciones]
  );
  const transaccionesDelEvento = useMemo(
    () =>
      eventoSeleccionado
        ? transaccionesConEvento.filter((t) => eventoDe(t) === eventoSeleccionado)
        : transaccionesConEvento,
    [transaccionesConEvento, eventoSeleccionado]
  );
  const gastoPorCategoriaDelEvento = useMemo(
    () => agruparPorCategoria(transaccionesDelEvento),
    [transaccionesDelEvento]
  );
  const gastoPorComercioDelEvento = useMemo(
    () => agruparPorComercio(transaccionesDelEvento),
    [transaccionesDelEvento]
  );

  function alternarEvento(evento: string) {
    setEventoSeleccionado((anterior) => (anterior === evento ? null : evento));
  }

  const hayFiltrosActivos = Boolean(fechaDesde || fechaHasta || cuenta || tarjeta);

  const coincidencias = useMemo(() => {
    if (!hayFiltrosActivos) return [];
    return transacciones.filter((t) => {
      if (fechaDesde && t.fecha < fechaDesde) return false;
      if (fechaHasta && t.fecha > fechaHasta) return false;
      if (cuenta && cuentaDe(t) !== cuenta) return false;
      if (tarjeta && t.tarjeta !== tarjeta) return false;
      return true;
    });
  }, [transacciones, hayFiltrosActivos, fechaDesde, fechaHasta, cuenta, tarjeta]);
  const visibles = coincidencias.slice(0, TOPE_RESULTADOS);

  function alternarSeleccion(id: string) {
    setSeleccionadas((anterior) => {
      const nueva = new Set(anterior);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  function seleccionarTodasLasCoincidencias() {
    setSeleccionadas(new Set(coincidencias.map((t) => t.id)));
  }

  function limpiarSeleccion() {
    setSeleccionadas(new Set());
  }

  async function aplicarEvento() {
    const evento = nuevoEvento.trim();
    if (seleccionadas.size === 0 || !evento) return;

    setGuardando(true);
    setMensaje(null);
    try {
      await actualizarCategoriaComercioYEvento(Array.from(seleccionadas), { evento });
      setMensaje({
        tipo: "ok",
        texto: `Se asignó "${evento}" a ${seleccionadas.size} transacción(es).`,
      });
      setSeleccionadas(new Set());
      setNuevoEvento("");
      await onActualizado();
    } catch (e) {
      setMensaje({
        tipo: "error",
        texto: e instanceof Error ? e.message : "No se pudo actualizar.",
      });
    } finally {
      setGuardando(false);
    }
  }

  const puedeAplicar = seleccionadas.size > 0 && nuevoEvento.trim() && !guardando;

  return (
    <div className="space-y-4">
      <GastoPorEventoChart
        datos={gastoPorEvento}
        eventoSeleccionado={eventoSeleccionado}
        onClickEvento={alternarEvento}
      />

      {eventoSeleccionado && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setEventoSeleccionado(null)}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: "var(--series-1)", color: "#ffffff" }}
            title="Quitar este filtro"
          >
            Evento: {eventoSeleccionado} ×
          </button>
        </div>
      )}

      {transaccionesConEvento.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <GastoPorCategoriaChart datos={gastoPorCategoriaDelEvento} />
            <GastoPorComercioChart datos={gastoPorComercioDelEvento} />
          </div>

          <TransaccionesTabla transacciones={transaccionesDelEvento} />
        </>
      )}

      <div
        className="rounded-lg p-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Asignar transacciones a un evento
        </h3>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          Filtra por fecha, cuenta y/o tarjeta para encontrar las transacciones de un
          viaje, fiesta u otro evento, selecciónalas y asígnales un nombre de evento
          (existente o nuevo).
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Desde
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => {
                setFechaDesde(e.target.value);
                setSeleccionadas(new Set());
              }}
              className="mt-1 block rounded-md px-3 py-2 text-sm"
              style={{
                background: "var(--page-plane)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            />
          </label>

          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Hasta
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => {
                setFechaHasta(e.target.value);
                setSeleccionadas(new Set());
              }}
              className="mt-1 block rounded-md px-3 py-2 text-sm"
              style={{
                background: "var(--page-plane)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            />
          </label>

          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Cuenta
            <select
              value={cuenta}
              onChange={(e) => {
                setCuenta(e.target.value);
                setSeleccionadas(new Set());
              }}
              className="mt-1 block w-48 rounded-md px-3 py-2 text-sm"
              style={{
                background: "var(--page-plane)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            >
              <option value="">(todas)</option>
              {cuentasExistentes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          {tarjetasExistentes.length > 0 && (
            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Tarjeta
              <select
                value={tarjeta}
                onChange={(e) => {
                  setTarjeta(e.target.value);
                  setSeleccionadas(new Set());
                }}
                className="mt-1 block w-40 rounded-md px-3 py-2 text-sm"
                style={{
                  background: "var(--page-plane)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              >
                <option value="">(todas)</option>
                {tarjetasExistentes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}

          {hayFiltrosActivos && (
            <button
              onClick={() => {
                setFechaDesde("");
                setFechaHasta("");
                setCuenta("");
                setTarjeta("");
                setSeleccionadas(new Set());
              }}
              className="text-xs underline"
              style={{ color: "var(--text-muted)" }}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {hayFiltrosActivos && (
          <>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {coincidencias.length} coincidencia(s)
                {coincidencias.length > TOPE_RESULTADOS &&
                  ` (mostrando las primeras ${TOPE_RESULTADOS})`}
              </span>
              <div className="flex gap-3">
                <button
                  onClick={seleccionarTodasLasCoincidencias}
                  disabled={coincidencias.length === 0}
                  className="text-xs underline disabled:opacity-50"
                  style={{ color: "var(--series-1)" }}
                >
                  Seleccionar todas las coincidencias
                </button>
                <button
                  onClick={limpiarSeleccion}
                  disabled={seleccionadas.size === 0}
                  className="text-xs underline disabled:opacity-50"
                  style={{ color: "var(--text-muted)" }}
                >
                  Limpiar selección
                </button>
              </div>
            </div>

            <div
              className="mt-2 max-h-96 overflow-auto rounded-md"
              style={{ border: "1px solid var(--border)" }}
            >
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <tbody>
                  {visibles.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => alternarSeleccion(t.id)}
                      className="cursor-pointer"
                      style={{ borderBottom: "1px solid var(--gridline)" }}
                    >
                      <td className="w-8 py-2 pl-2">
                        <input
                          type="checkbox"
                          checked={seleccionadas.has(t.id)}
                          onChange={() => alternarSeleccion(t.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="py-2 pr-2" style={{ color: "var(--text-secondary)" }}>
                        {formateadorFecha.format(new Date(t.fecha + "T00:00:00"))}
                      </td>
                      <td className="py-2 pr-2" style={{ color: "var(--text-primary)" }}>
                        {t.descripcion}
                      </td>
                      <td className="py-2 pr-2" style={{ color: "var(--text-secondary)" }}>
                        {t.documentos.cuentas.alias}
                      </td>
                      <td className="py-2 pr-2" style={{ color: "var(--text-secondary)" }}>
                        {t.tarjeta ?? "—"}
                      </td>
                      <td className="py-2 pr-2" style={{ color: "var(--text-secondary)" }}>
                        {t.eventos?.nombre ?? "—"}
                      </td>
                      <td
                        className="py-2 pr-2 text-right"
                        style={{
                          color: "var(--text-secondary)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {formateadorMoneda.format(t.monto)}
                      </td>
                    </tr>
                  ))}
                  {visibles.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-4 text-center text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Sin coincidencias.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Evento
                <input
                  type="text"
                  list="eventos-existentes"
                  value={nuevoEvento}
                  onChange={(e) => setNuevoEvento(e.target.value)}
                  placeholder="ej. Viaje a Cancún"
                  className="mt-1 block w-56 rounded-md px-3 py-2 text-sm"
                  style={{
                    background: "var(--page-plane)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                  }}
                />
                <datalist id="eventos-existentes">
                  {eventosExistentes.map((e) => (
                    <option key={e} value={e} />
                  ))}
                </datalist>
              </label>

              <button
                onClick={aplicarEvento}
                disabled={!puedeAplicar}
                className="rounded-md px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                style={{ background: "var(--series-1)" }}
              >
                {guardando
                  ? "Aplicando..."
                  : `Asignar a ${seleccionadas.size} seleccionada(s)`}
              </button>
            </div>

            {mensaje && (
              <p
                className="mt-2 text-xs"
                style={{
                  color:
                    mensaje.tipo === "ok" ? "var(--status-good)" : "var(--status-critical)",
                }}
              >
                {mensaje.texto}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
