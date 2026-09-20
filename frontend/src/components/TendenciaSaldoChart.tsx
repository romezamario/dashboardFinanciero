import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PuntoSaldo } from "../lib/queries";

// Orden fijo — nunca se elige el color por cuál cuenta es, solo por su
// posición en esta lista (así el mismo alias siempre tiene el mismo color
// entre recargas). Más de 3 cuentas reutiliza el último tono (degradación
// razonable para un caso que no debería darse en un uso personal normal).
const COLORES_SERIE = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

const formateadorEje = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const formateadorTooltip = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

interface TendenciaSaldoChartProps {
  puntos: PuntoSaldo[];
  cuentas: string[];
  cuentaSeleccionada?: string;
  onClickCuenta?: (cuenta: string) => void;
}

export function TendenciaSaldoChart({
  puntos,
  cuentas,
  cuentaSeleccionada,
  onClickCuenta,
}: TendenciaSaldoChartProps) {
  const opacidad = (cuenta: string) =>
    !cuentaSeleccionada || cuentaSeleccionada === cuenta ? 1 : 0.25;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Tendencia de saldo
        {onClickCuenta && cuentas.length > 1 && (
          <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
            (clic en una línea para filtrar por cuenta)
          </span>
        )}
      </h3>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={puntos}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
            <XAxis
              dataKey="fecha"
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
            {cuentas.length > 1 && (
              <Legend
                formatter={(value) => (
                  <span style={{ color: "var(--text-secondary)" }}>{value}</span>
                )}
              />
            )}
            {cuentas.map((cuenta, i) => (
              <Line
                key={cuenta}
                type="monotone"
                dataKey={cuenta}
                name={cuenta}
                stroke={COLORES_SERIE[Math.min(i, COLORES_SERIE.length - 1)]}
                strokeWidth={2}
                strokeOpacity={cuentas.length > 1 ? opacidad(cuenta) : 1}
                dot={{ r: 4, fillOpacity: cuentas.length > 1 ? opacidad(cuenta) : 1 }}
                connectNulls
                onClick={
                  onClickCuenta && cuentas.length > 1
                    ? () => onClickCuenta(cuenta)
                    : undefined
                }
                style={
                  onClickCuenta && cuentas.length > 1 ? { cursor: "pointer" } : undefined
                }
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
