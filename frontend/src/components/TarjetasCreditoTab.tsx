import { useMemo } from "react";
import {
  enMeses,
  MESES_PERIODO_POR_DEFECTO,
  RANGO_MESES_VACIO,
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
import { aplicarFiltros, cuentaDe, type Filtros } from "../lib/queries";
import type { Transaccion } from "../lib/types";
import {
  CategoriaPorTarjetaChart,
  DistribucionGastoTarjetas,
  GastoMensualPorTarjetaChart,
} from "./ComparativoTarjetasCharts";
import { Delta, SelectorPeriodo, Tabla } from "./IndicadoresUI";
import { Sparkline } from "./Sparkline";
import { TransaccionesTabla } from "./TransaccionesTabla";

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
  /** Filtros por clic (tarjeta = `cuenta`, `categoria`), también por pestaña
   * en `Dashboard`. */
  filtros: Filtros;
  onCambiarFiltros: (actualizar: (anterior: Filtros) => Filtros) => void;
}

// Etiqueta de cada filtro en los chips. En esta pestaña la dimensión
// `cuenta` es "la tarjeta" (TDC Beyond, Invex TDC...).
const ETIQUETAS_FILTRO: Record<keyof Filtros, string> = {
  cuenta: "Tarjeta",
  categoria: "Categoría",
  comercio: "Comercio",
  tarjeta: "Plástico",
  evento: "Evento",
};

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
  filtros,
  onCambiarFiltros,
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

  // Cross-filter estilo Power BI, igual que en el Resumen: cada vista se
  // calcula con todos los filtros por clic MENOS el de su propia dimensión,
  // para seguir mostrando (atenuadas) las demás opciones y poder cambiar la
  // selección. Las vistas POR TARJETA (reparto, comparativo, gasto mensual)
  // excluyen el filtro de tarjeta -- con categoría "Comida" elegida comparan
  // las tarjetas solo en Comida; la vista por categoría excluye el de
  // categoría -- con una tarjeta elegida muestra solo sus categorías.
  const paraTarjetas = useMemo(
    () => aplicarFiltros(transacciones, filtros, "cuenta"),
    [transacciones, filtros]
  );
  const paraCategorias = useMemo(
    () => aplicarFiltros(transacciones, filtros, "categoria"),
    [transacciones, filtros]
  );
  const movimientos = useMemo(
    () => enMeses(aplicarFiltros(transacciones, filtros), periodo.meses),
    [transacciones, filtros, periodo]
  );

  const comparativo = useMemo(
    () => compararTarjetas(paraTarjetas, tarjetas, periodo, mesesSerie),
    [paraTarjetas, tarjetas, periodo, mesesSerie]
  );
  const mensual = useMemo(
    () => gastoMensualPorTarjeta(paraTarjetas, tarjetas, mesesSerie),
    [paraTarjetas, tarjetas, mesesSerie]
  );
  const porCategoria = useMemo(
    () => gastoPorCategoriaYTarjeta(paraCategorias, tarjetas, periodo.meses),
    [paraCategorias, tarjetas, periodo]
  );

  // Clic en lo ya seleccionado lo quita (mismo comportamiento que el Resumen).
  function alternarFiltro(campo: keyof Filtros, valor: string) {
    onCambiarFiltros((anterior) => ({
      ...anterior,
      [campo]: anterior[campo] === valor ? undefined : valor,
    }));
  }
  const alternarTarjeta = (tarjeta: string) => alternarFiltro("cuenta", tarjeta);

  // Clic en un mes de la gráfica mensual: ese mes pasa a ser el periodo; otro
  // clic en el mismo mes vuelve al periodo por defecto.
  function elegirMes(mes: string) {
    onCambiarRangoMeses((anterior) =>
      anterior.desde === mes && anterior.hasta === mes ? RANGO_MESES_VACIO : { desde: mes, hasta: mes }
    );
  }

  const filtrosActivos = (Object.keys(filtros) as (keyof Filtros)[]).filter((c) => filtros[c]);
  const atenuarFila = (tarjeta: string) =>
    filtros.cuenta && filtros.cuenta !== tarjeta ? 0.35 : 1;

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

      {filtrosActivos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filtrosActivos.map((campo) => (
            <button
              key={campo}
              onClick={() => onCambiarFiltros((a) => ({ ...a, [campo]: undefined }))}
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: "var(--series-1)", color: "#ffffff" }}
              title="Quitar este filtro"
            >
              {ETIQUETAS_FILTRO[campo]}: {filtros[campo]} ×
            </button>
          ))}
          <button
            onClick={() => onCambiarFiltros(() => ({}))}
            className="text-xs underline"
            style={{ color: "var(--text-muted)" }}
          >
            Quitar filtros por clic
          </button>
        </div>
      )}

      <DistribucionGastoTarjetas
        tarjetas={tarjetas}
        gastos={comparativo.map((c) => c.gasto)}
        tarjetaSeleccionada={filtros.cuenta}
        onClickTarjeta={alternarTarjeta}
      />

      <Tabla
        titulo={`Comparativo por tarjeta, ${nombreDelPeriodo}${
          filtros.categoria ? ` — solo ${filtros.categoria}` : ""
        } (clic en una tarjeta para filtrar)`}
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
          <button
            key="tarjeta"
            type="button"
            onClick={() => alternarTarjeta(c.tarjeta)}
            aria-pressed={filtros.cuenta === c.tarjeta}
            className="inline-flex items-center gap-1.5"
            style={{
              opacity: atenuarFila(c.tarjeta),
              fontWeight: filtros.cuenta === c.tarjeta ? 600 : undefined,
            }}
            title={filtros.cuenta === c.tarjeta ? "Quitar este filtro" : "Filtrar por esta tarjeta"}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: colorTarjeta(i) }}
            />
            {c.tarjeta}
          </button>,
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
        tarjetaSeleccionada={filtros.cuenta}
        onClickMes={elegirMes}
        onClickTarjeta={alternarTarjeta}
      />

      <CategoriaPorTarjetaChart
        datos={porCategoria}
        tarjetas={tarjetas}
        categoriaSeleccionada={filtros.categoria}
        onClickCategoria={(categoria) => alternarFiltro("categoria", categoria)}
        onClickTarjeta={alternarTarjeta}
      />

      <TransaccionesTabla
        transacciones={movimientos}
        vacio="Ningún movimiento de tarjeta coincide con el periodo y los filtros elegidos."
      />

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {unMes ? `El mes ${nombreMes(ultimoMes)}` : "El periodo"} se compara siempre con el
        mismo número de meses inmediatamente anteriores. Para el detalle completo de una sola
        tarjeta (Sankey, indicadores, editor), usa el filtro de cuenta en el Resumen.
      </p>
    </>
  );
}
