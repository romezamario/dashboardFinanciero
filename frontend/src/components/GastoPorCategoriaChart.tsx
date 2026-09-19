import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PuntoCategoria } from "../lib/queries";

const formateadorMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export function GastoPorCategoriaChart({ datos }: { datos: PuntoCategoria[] }) {
  // Ordenado descendente, más de ~8 categorías se pliegan en "Otros" para no
  // saturar el eje vertical.
  const TOPE = 8;
  const visibles = datos.slice(0, TOPE);
  const resto = datos.slice(TOPE);
  const otros = resto.reduce((suma, d) => suma + d.total, 0);
  const datosFinales =
    otros > 0 ? [...visibles, { categoria: "Otros", total: otros }] : visibles;

  const alturaFila = 32;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Gasto por categoría
      </h3>
      <div style={{ height: Math.max(200, datosFinales.length * alturaFila + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={datosFinales}
            layout="vertical"
            margin={{ left: 8, right: 48 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--gridline)" strokeWidth={1} />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="categoria"
              tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={140}
            />
            <Tooltip
              formatter={(value) => formateadorMoneda.format(Number(value))}
              contentStyle={{
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text-primary)",
              }}
            />
            <Bar dataKey="total" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={20}>
              <LabelList
                dataKey="total"
                position="right"
                formatter={(v) => formateadorMoneda.format(Number(v))}
                style={{ fill: "var(--text-secondary)", fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
