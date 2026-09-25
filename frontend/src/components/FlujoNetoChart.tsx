import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ResumenMes } from "../lib/indicadores";

const formateadorEje = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const formateadorMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});
const formateadorPorcentaje = new Intl.NumberFormat("es-MX", {
  style: "percent",
  maximumFractionDigits: 0,
});

// Polaridad sobre una línea base en 0 (ahorro arriba, déficit abajo): se
// reutilizan los dos tonos ya validados del dashboard -- azul del lado
// "ingresos ganan", naranja del lado "gastos ganan" -- en vez de agregar
// colores nuevos a la paleta.
const COLOR_AHORRO = "var(--series-1)";
const COLOR_DEFICIT = "var(--series-2)";

export function FlujoNetoChart({ datos }: { datos: ResumenMes[] }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Flujo neto mensual (ingresos − gastos), últimos 12 meses completos
        </h3>
        <div className="flex gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
          <Leyenda color={COLOR_AHORRO} texto="Ahorro" />
          <Leyenda color={COLOR_DEFICIT} texto="Déficit" />
        </div>
      </div>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
            <XAxis
              dataKey="mes"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formateadorEje.format(v)}
            />
            <ReferenceLine y={0} stroke="var(--baseline)" />
            <Tooltip
              cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as ResumenMes;
                return (
                  <div
                    className="rounded-lg px-3 py-2 text-xs"
                    style={{
                      background: "var(--surface-1)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <div className="font-medium">{d.mes}</div>
                    <div style={{ color: "var(--text-secondary)" }}>
                      Ingresos: {formateadorMoneda.format(d.ingresos)}
                    </div>
                    <div style={{ color: "var(--text-secondary)" }}>
                      Gastos: {formateadorMoneda.format(d.gastos)}
                    </div>
                    <div>
                      {d.neto >= 0 ? "Ahorro" : "Déficit"}: {formateadorMoneda.format(d.neto)}
                    </div>
                    <div style={{ color: "var(--text-secondary)" }}>
                      Tasa de ahorro:{" "}
                      {d.tasaAhorro === null ? "sin ingresos" : formateadorPorcentaje.format(d.tasaAhorro)}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="neto" name="Flujo neto" radius={[4, 4, 0, 0]} maxBarSize={28}>
              {datos.map((d) => (
                <Cell key={d.mes} fill={d.neto >= 0 ? COLOR_AHORRO : COLOR_DEFICIT} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {texto}
    </span>
  );
}
