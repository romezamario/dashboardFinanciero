import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PuntoIngresoGasto } from "../lib/queries";

const formateadorEje = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const formateadorTooltip = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export function IngresosGastosChart({ datos }: { datos: PuntoIngresoGasto[] }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Ingresos vs. gastos por mes
      </h3>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} barGap={2}>
            <CartesianGrid
              vertical={false}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
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
                <span style={{ color: "var(--text-secondary)" }}>{value}</span>
              )}
            />
            <Bar
              dataKey="ingresos"
              name="Ingresos"
              fill="var(--series-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
            <Bar
              dataKey="gastos"
              name="Gastos"
              fill="var(--series-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
