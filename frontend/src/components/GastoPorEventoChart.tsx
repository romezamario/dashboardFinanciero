import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PuntoEvento } from "../lib/queries";

const formateadorMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

interface GastoPorEventoChartProps {
  datos: PuntoEvento[];
}

/**
 * Mismo patrón que GastoPorComercioChart (barras agrupadas
 * ingresos/gastos, sin fallback "Sin evento" ni "Otros"), pero sin
 * cross-filter -- EventosTab es una pestaña separada del Resumen y no
 * comparte su estado de `filtros`, así que aquí es solo lectura.
 */
export function GastoPorEventoChart({ datos }: GastoPorEventoChartProps) {
  const TOPE = 8;
  const datosFinales = datos.slice(0, TOPE);

  const alturaFila = 44;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        Ingresos y gastos por evento
      </h3>
      {datosFinales.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Ninguna transacción tiene un evento asignado todavía -- selecciona
          transacciones arriba y asígnales uno.
        </p>
      ) : (
        <div style={{ height: Math.max(220, datosFinales.length * alturaFila + 40) }}>
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
                dataKey="evento"
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
              <Legend
                formatter={(value) => (
                  <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{value}</span>
                )}
              />
              <Bar dataKey="ingresos" name="Ingresos" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={16}>
                <LabelList
                  dataKey="ingresos"
                  position="right"
                  formatter={(v: unknown) => formateadorMoneda.format(Number(v))}
                  style={{ fill: "var(--text-secondary)", fontSize: 12 }}
                />
              </Bar>
              <Bar dataKey="gastos" name="Gastos" fill="var(--series-2)" radius={[0, 4, 4, 0]} maxBarSize={16}>
                <LabelList
                  dataKey="gastos"
                  position="right"
                  formatter={(v: unknown) => formateadorMoneda.format(Number(v))}
                  style={{ fill: "var(--text-secondary)", fontSize: 12 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
