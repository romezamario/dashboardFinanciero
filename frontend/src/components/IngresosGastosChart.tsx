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

export type VistaTiempo = "meses" | "anios";

interface IngresosGastosChartProps {
  /** Un punto por mes o por año, según `vista`. */
  datos: PuntoIngresoGasto[];
  vista: VistaTiempo;
  onCambiarVista?: (vista: VistaTiempo) => void;
  /** Mes ("2026-06") o año ("2026") seleccionado por cross-filter. */
  seleccionado?: string;
  onClickPeriodo?: (periodo: string) => void;
}

export function IngresosGastosChart({
  datos,
  vista,
  onCambiarVista,
  seleccionado,
  onClickPeriodo,
}: IngresosGastosChartProps) {
  // Cuando hay una selección, lo no seleccionado se atenúa en vez de
  // desaparecer -- así se ve qué está filtrado sin perder el eje completo.
  const opacidad = (periodo: string) =>
    !seleccionado || seleccionado === periodo ? 1 : 0.3;
  const unidad = vista === "anios" ? "año" : "mes";

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Ingresos vs. gastos por {unidad}
          {onClickPeriodo && (
            <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
              (clic en un {unidad} para filtrar)
            </span>
          )}
        </h3>
        {onCambiarVista && (
          <div
            className="flex rounded-md p-0.5 text-xs"
            style={{ border: "1px solid var(--border)" }}
            role="group"
            aria-label="Agrupar por"
          >
            {(
              [
                ["meses", "Meses"],
                ["anios", "Años"],
              ] as const
            ).map(([valor, texto]) => (
              <button
                key={valor}
                onClick={() => onCambiarVista(valor)}
                aria-pressed={vista === valor}
                className="rounded px-3 py-1 font-medium"
                style={{
                  background: vista === valor ? "var(--series-1)" : "transparent",
                  color: vista === valor ? "#ffffff" : "var(--text-secondary)",
                }}
              >
                {texto}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} barGap={2}>
            <CartesianGrid
              vertical={false}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="periodo"
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
              dataKey="ingresos"
              name="Ingresos"
              fill="var(--series-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={vista === "anios" ? 48 : 24}
              onClick={onClickPeriodo ? (d) => onClickPeriodo(d.payload.periodo) : undefined}
              cursor={onClickPeriodo ? "pointer" : undefined}
            >
              {datos.map((d) => (
                <Cell key={d.periodo} fillOpacity={opacidad(d.periodo)} />
              ))}
            </Bar>
            <Bar
              dataKey="gastos"
              name="Gastos"
              fill="var(--series-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={vista === "anios" ? 48 : 24}
              onClick={onClickPeriodo ? (d) => onClickPeriodo(d.payload.periodo) : undefined}
              cursor={onClickPeriodo ? "pointer" : undefined}
            >
              {datos.map((d) => (
                <Cell key={d.periodo} fillOpacity={opacidad(d.periodo)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
