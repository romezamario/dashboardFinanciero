import { useEffect, useMemo, useState } from "react";
import {
  agruparPorDia,
  DIAS_HISTORIAL,
  nombreTarjeta,
  obtenerGastosCorreo,
  tituloDia,
  type DiaGastos,
  type GastoCorreo,
  type Sumas,
} from "../lib/gastosCorreo";

const formatoMoneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

/** Los centavos en 0 se dejan en blanco, como en el reporte diario. */
function dinero(centavos: number | undefined): string {
  return centavos ? formatoMoneda.format(centavos / 100) : "";
}

/**
 * Pestaña "Gastos recientes": cargos de los avisos de compra de Banamex,
 * un día por sección (el más reciente abierto). Cada día muestra el resumen
 * por categoría y tarjeta y el detalle por transacción con ciudad, subtotales
 * por comercio (solo si hay más de una compra) y por categoría. Los datos
 * vienen de `gastos_correo`, aparte de `transacciones`, así que no se mezclan
 * con los estados de cuenta ni con los filtros del Resumen.
 */
export function GastosCorreoTab() {
  const [gastos, setGastos] = useState<GastoCorreo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string> | null>(null);

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

  // Hasta que el usuario abre o cierra algo, solo el día más reciente está abierto.
  const abiertosEfectivos = abiertos ?? new Set([dias[0].fecha]);

  function alternar(fecha: string, abierto: boolean) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior ?? [dias[0].fecha]);
      if (abierto) siguiente.add(fecha);
      else siguiente.delete(fecha);
      return siguiente;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Cargos de los avisos de compra de Banamex, del día más reciente al más antiguo (últimos{" "}
        {DIAS_HISTORIAL} días). Horas en CDMX, montos en MXN. Aparte de tus estados de cuenta: los
        cargos de aquí aún no se concilian con ellos.
      </p>
      {dias.map((dia) => (
        <details
          key={dia.fecha}
          open={abiertosEfectivos.has(dia.fecha)}
          onToggle={(e) => alternar(dia.fecha, e.currentTarget.open)}
          className="rounded-md"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
        >
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {tituloDia(dia.fecha)}
            </h2>
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
          </summary>
          <div className="space-y-5 px-4 pb-4 pt-2">
            <TablaResumen dia={dia} />
            <TablaDetalle dia={dia} />
          </div>
        </details>
      ))}
    </div>
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

