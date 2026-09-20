import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

interface IngresosGastosChartProps {
  datos: PuntoIngresoGasto[];
  mesSeleccionado?: string;
  onClickMes?: (mes: string) => void;
}

export function IngresosGastosChart({
  datos,
  mesSeleccionado,
  onClickMes,
}: IngresosGastosChartProps) {
  // Cuando hay una selección, lo no seleccionado se atenúa en vez de
  // desaparecer -- así se ve qué está filtrado sin perder el eje completo.
  const opacidad = (mes: string) =>
    !mesSeleccionado || mesSeleccionado === mes ? 1 : 0.3;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Ingresos vs. gastos por mes
        {onClickMes && (
          <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
            (clic en un mes para filtrar)
          </span>
        )}
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
              onClick={onClickMes ? (d) => onClickMes(d.payload.mes) : undefined}
              cursor={onClickMes ? "pointer" : undefined}
            >
              {datos.map((d) => (
                <Cell key={d.mes} fillOpacity={opacidad(d.mes)} />
              ))}
            </Bar>
            <Bar
              dataKey="gastos"
              name="Gastos"
              fill="var(--series-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              onClick={onClickMes ? (d) => onClickMes(d.payload.mes) : undefined}
              cursor={onClickMes ? "pointer" : undefined}
            >
              {datos.map((d) => (
                <Cell key={d.mes} fillOpacity={opacidad(d.mes)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
