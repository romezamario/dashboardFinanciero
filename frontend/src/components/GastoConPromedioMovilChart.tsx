import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PuntoGastoConPromedioMovil } from "../lib/indicadores";

const formateadorEje = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const formateadorTooltip = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

interface GastoConPromedioMovilChartProps {
  datos: PuntoGastoConPromedioMovil[];
  titulo: string;
}

/**
 * Barras de gasto mensual + línea del promedio móvil de 3 meses encima --
 * el gasto mes a mes puede subir/bajar por un cargo puntual, la línea
 * suaviza eso y deja ver si la tendencia de fondo va al alza o a la baja.
 * `connectNulls={false}` dado que `promedioMovil` viene en `null` para los
 * primeros meses de la ventana (sin suficiente historial detrás todavía).
 */
export function GastoConPromedioMovilChart({ datos, titulo }: GastoConPromedioMovilChartProps) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {titulo}
      </h3>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={datos}>
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
              contentStyle={{
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text-primary)",
              }}
            />
            <Legend
              formatter={(value) => (
                <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{value}</span>
              )}
            />
            <Bar
              dataKey="gastos"
              name="Gasto mensual"
              fill="var(--series-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
            <Line
              dataKey="promedioMovil"
              name="Promedio móvil (3 meses)"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
