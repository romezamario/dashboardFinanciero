import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEsMovil } from "../hooks/useEsMovil";
import type { LadoMovimiento, PuntoGastoConPromedioMovil } from "../lib/indicadores";
import { compacto as formateadorEje, monedaConCentavos as formateadorTooltip } from "../lib/formato";
import { ANCHO_COLUMNA_PROMEDIOS, promediosDesdeElPrimerGasto } from "../lib/promedios";
import { EtiquetasPromedios } from "./EtiquetasPromedios";
import { estiloTooltip } from "../lib/estilos";

interface GastoConPromedioMovilChartProps {
  datos: PuntoGastoConPromedioMovil[];
  titulo: string;
  /** "ingreso" para selecciones de puros abonos: cambia la etiqueta de las
   * barras y los colores (azul = ingresos, naranja = gastos, igual que el
   * resto del dashboard). */
  lado?: LadoMovimiento;
  /** Mes ("YYYY-MM") elegido con un clic (cross-filter, estilo Power BI): su
   * barra queda completa y las demás se atenúan. */
  mesSeleccionado?: string;
  /** Clic en un mes (en cualquier punto de su columna, no solo sobre la barra,
   * que en los meses bajos es muy delgada). Sin él la gráfica no es clicable. */
  onClickMes?: (mes: string) => void;
}

/**
 * Barras de gasto mensual + línea del promedio móvil de 3 meses encima --
 * el gasto mes a mes puede subir/bajar por un cargo puntual, la línea
 * suaviza eso y deja ver si la tendencia de fondo va al alza o a la baja.
 * `connectNulls={false}` dado que `promedioMovil` viene en `null` para los
 * primeros meses de la ventana (sin suficiente historial detrás todavía).
 *
 * Además, dos líneas horizontales de referencia (promedio plano de los
 * últimos 3 y de los últimos 12 meses) para comparar el nivel reciente
 * contra el de más largo plazo -- se inyectan como campos constantes en
 * cada punto para que Recharts las dibuje como líneas de ancho completo y
 * aparezcan en el tooltip igual que las demás series.
 *
 * Los nombres y valores de las tres líneas van en una columna a la derecha, a la
 * altura de cada línea (`EtiquetasPromedios`, el mismo estilo que las etiquetas
 * de QQQ y de la gráfica de Shophunters) en vez de la leyenda; en un teléfono no
 * cabe la columna y los nombres se quedan en la leyenda.
 */
export function GastoConPromedioMovilChart({
  datos,
  titulo,
  lado = "gasto",
  mesSeleccionado,
  onClickMes,
}: GastoConPromedioMovilChartProps) {
  const esMovil = useEsMovil();
  const columnaAlLado = !esMovil && datos.length > 0;
  const esIngreso = lado === "ingreso";
  const colorBarras = esIngreso ? "var(--series-1)" : "var(--series-2)";
  const colorPromedioMovil = esIngreso ? "var(--series-2)" : "var(--series-1)";
  // Promedios desde el primer mes con monto: los meses anteriores en $0 (una categoría o un
  // comercio nuevos) no son meses de gasto cero y no deben bajar los promedios.
  const promedios = useMemo(() => promediosDesdeElPrimerGasto(datos.map((punto) => punto.monto)), [datos]);
  const { ultimos3: promedioUltimos3, ultimos12: promedioUltimos12 } = promedios;
  const datosConPromedios = useMemo(
    () =>
      datos.map((punto, i) => ({
        ...punto,
        promedioMovil: promedios.movil[i],
        promedioUltimos3,
        promedioUltimos12,
      })),
    [datos, promedios, promedioUltimos3, promedioUltimos12]
  );

  return (
    <div
      className="rounded-lg p-4 tarjeta"
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {titulo}
        {onClickMes && (
          <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
            (clic en un mes para filtrar lo de abajo)
          </span>
        )}
      </h3>
      <div className="mt-3 h-72" style={onClickMes ? { cursor: "pointer" } : undefined}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={datosConPromedios}
            margin={{ top: 5, right: columnaAlLado ? ANCHO_COLUMNA_PROMEDIOS : 5, bottom: 5, left: 5 }}
            onClick={
              onClickMes
                ? (estado) => {
                    // `activeLabel` = el mes de la columna bajo el cursor.
                    const mes = estado?.activeLabel;
                    if (typeof mes === "string") onClickMes(mes);
                  }
                : undefined
            }
          >
            <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
            <XAxis
              dataKey="mes"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={{ stroke: "var(--baseline)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formateadorEje.format(v)}
            />
            <Tooltip
              formatter={(value) => formateadorTooltip.format(Number(value))}
              contentStyle={estiloTooltip}
            />
            <Legend
              formatter={(value) => (
                <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{value}</span>
              )}
            />
            <Bar
              dataKey="monto"
              name={esIngreso ? "Ingreso mensual" : "Gasto mensual"}
              fill={colorBarras}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            >
              {datosConPromedios.map((d) => (
                <Cell
                  key={d.mes}
                  fillOpacity={mesSeleccionado && d.mes !== mesSeleccionado ? 0.3 : 1}
                />
              ))}
            </Bar>
            <Line
              dataKey="promedioMovil"
              name="Promedio móvil (3 meses)"
              stroke={colorPromedioMovil}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              legendType={columnaAlLado ? "none" : "line"}
            />
            <Line
              dataKey="promedioUltimos3"
              name="Promedio últimos 3 meses"
              stroke="var(--text-secondary)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              legendType={columnaAlLado ? "none" : "line"}
            />
            <Line
              dataKey="promedioUltimos12"
              name="Promedio últimos 12 meses"
              stroke="var(--text-muted)"
              strokeWidth={1.5}
              strokeDasharray="2 6"
              dot={false}
              legendType={columnaAlLado ? "none" : "line"}
            />
            {columnaAlLado && (
              <EtiquetasPromedios
                items={[
                  ...(promedioUltimos3 === null
                    ? []
                    : [{ nombre: "Promedio últimos 3 meses", valor: promedioUltimos3, color: "var(--text-secondary)", ancho: 1.5, trazo: "4 4" }]),
                  ...(promedioUltimos12 === null
                    ? []
                    : [{ nombre: "Promedio últimos 12 meses", valor: promedioUltimos12, color: "var(--text-muted)", ancho: 1.5, trazo: "2 6" }]),
                ]}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
