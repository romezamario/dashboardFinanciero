import { useMemo } from "react";
import {
  MESES_PERIODO_POR_DEFECTO,
  mesesHasta,
  nombreMes,
  nombrePeriodo,
  resolverPeriodo,
  type RangoMeses,
} from "../lib/indicadores";
import {
  colorTarjeta,
  compararTarjetas,
  gastoMensualPorTarjeta,
  gastoPorCategoriaYTarjeta,
} from "../lib/tarjetas";
import { cuentaDe } from "../lib/queries";
import type { Transaccion } from "../lib/types";
import {
  CategoriaPorTarjetaChart,
  DistribucionGastoTarjetas,
  GastoMensualPorTarjetaChart,
} from "./ComparativoTarjetasCharts";
import { Delta, SelectorPeriodo, Tabla } from "./IndicadoresUI";
import { Sparkline } from "./Sparkline";

const moneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});
const porcentaje = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });

interface TarjetasCreditoTabProps {
  /** Solo transacciones de cuentas que son tarjeta de crédito
   * (`esTarjetaCredito`); la cuenta de cheques no entra aquí. */
  transacciones: Transaccion[];
  /** El periodo vive en `Dashboard` (estado por pestaña), igual que en el
   * Resumen, para no perderse al cambiar de pestaña. */
  rangoMeses: RangoMeses;
  onCambiarRangoMeses: (actualizar: (anterior: RangoMeses) => RangoMeses) => void;
}

/**
 * Una sola pestaña que reemplaza a las pestañas individuales de cada tarjeta
 * de crédito, para COMPARAR su uso: reparto del gasto, tabla comparativa,
 * gasto mensual apilado y para qué categorías se usa cada una. Mismo
 * selector de periodo que el Resumen (sin filtro: últimos 3 meses completos).
 */
export function TarjetasCreditoTab({
  transacciones,
  rangoMeses,
  onCambiarRangoMeses,
}: TarjetasCreditoTabProps) {
  // Orden alfabético fijo de TODAS las tarjetas (no solo las que tienen gasto
  // en el periodo): define el color de cada una, así que no puede depender de
  // los datos filtrados o un cambio de periodo las repintaría.
  const tarjetas = useMemo(
    () => Array.from(new Set(transacciones.map(cuentaDe))).sort(),
    [transacciones]
  );
  const mesesConDatos = useMemo(
    () => Array.from(new Set(transacciones.map((t) => t.fecha.slice(0, 7)))).sort().reverse(),
    [transacciones]
  );

  const periodo = useMemo(() => resolverPeriodo(rangoMeses), [rangoMeses]);
  const ultimoMes = periodo.meses[periodo.meses.length - 1];
  const mesesSerie = useMemo(() => mesesHasta(ultimoMes, 12), [ultimoMes]);
  const mesesDelPeriodo = useMemo(() => new Set(periodo.meses), [periodo]);
  const unMes = periodo.meses.length === 1;
  const nombreDelPeriodo = periodo.porDefecto
    ? `últimos ${MESES_PERIODO_POR_DEFECTO} meses (${nombrePeriodo(periodo.meses)})`
    : nombrePeriodo(periodo.meses);
  const nombreDelAnterior = nombrePeriodo(periodo.anteriores);

  const comparativo = useMemo(
    () => compararTarjetas(transacciones, tarjetas, periodo, mesesSerie),
    [transacciones, tarjetas, periodo, mesesSerie]
  );
  const mensual = useMemo(
    () => gastoMensualPorTarjeta(transacciones, tarjetas, mesesSerie),
    [transacciones, tarjetas, mesesSerie]
  );
  const porCategoria = useMemo(
    () => gastoPorCategoriaYTarjeta(transacciones, tarjetas, periodo.meses),
    [transacciones, tarjetas, periodo]
  );

  if (tarjetas.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        No hay estados de cuenta de tarjetas de crédito sincronizados.
      </p>
    );
  }

  return (
    <>
      <SelectorPeriodo
        rangoMeses={rangoMeses}
        onCambiarRangoMeses={onCambiarRangoMeses}
        mesesConDatos={mesesConDatos}
      />
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Periodo: <strong>{nombreDelPeriodo}</strong>. "Gasto" son los cargos de cada tarjeta
        (compras, comisiones, disposiciones); los pagos y devoluciones van aparte. Las
        variaciones se comparan contra {nombreDelAnterior}.
      </p>

      <DistribucionGastoTarjetas
        tarjetas={tarjetas}
        gastos={comparativo.map((c) => c.gasto)}
      />

      <Tabla
        titulo={`Comparativo por tarjeta, ${nombreDelPeriodo}`}
        vacio="Sin datos de tarjetas en el periodo."
        encabezados={[
          "Tarjeta",
          "Gasto",
          "Compras",
          "Ticket promedio",
          "vs. anterior",
          "Pagos y abonos",
          "Categoría principal",
          "Tendencia 12 meses",
        ]}
        filas={comparativo.map((c, i) => [
          <span key="tarjeta" className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: colorTarjeta(i) }}
            />
            {c.tarjeta}
          </span>,
          moneda.format(c.gasto),
          String(c.compras),
          c.ticketPromedio === null ? "—" : moneda.format(c.ticketPromedio),
          c.variacion === null ? (
            "—"
          ) : Math.abs(c.variacion) < 0.005 ? (
            // Redondearía a "0%": una flecha (y su color) sugeriría un cambio
            // que no existe.
            "sin cambio"
          ) : (
            <Delta
              key="variacion"
              texto={`${c.variacion >= 0 ? "+" : ""}${porcentaje.format(c.variacion)}`}
              sube={c.variacion > 0}
              favorable={c.variacion <= 0}
            />
          ),
          moneda.format(c.pagos),
          c.categoriaPrincipal?.nombre ?? "—",
          <Sparkline
            key="tendencia"
            valores={c.serie}
            meses={mesesSerie}
            resaltados={mesesDelPeriodo}
            etiqueta={c.tarjeta}
            color={colorTarjeta(i)}
          />,
        ])}
      />

      <GastoMensualPorTarjetaChart
        datos={mensual}
        tarjetas={tarjetas}
        resaltados={mesesDelPeriodo}
      />

      <CategoriaPorTarjetaChart datos={porCategoria} tarjetas={tarjetas} />

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {unMes ? `El mes ${nombreMes(ultimoMes)}` : "El periodo"} se compara siempre con el
        mismo número de meses inmediatamente anteriores. Para ver el detalle de una sola
        tarjeta (gráficas, Sankey, transacciones), usa el filtro de cuenta en el Resumen.
      </p>
    </>
  );
}
