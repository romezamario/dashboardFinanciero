import { useMemo } from "react";
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
import type { LadoMovimiento, PuntoGastoConPromedioMovil } from "../lib/indicadores";

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
  /** "ingreso" para selecciones de puros abonos: cambia la etiqueta de las
   * barras y los colores (azul = ingresos, naranja = gastos, igual que el
   * resto del dashboard). */
  lado?: LadoMovimiento;
}

/** Promedio plano del monto sobre los últimos `n` meses visibles en `datos`
 * (no una ventana móvil por mes, a diferencia de `promedioMovil`) -- una
 * sola línea horizontal de referencia para comparar el nivel actual contra
 * el corto y el largo plazo. */
function promedioDeUltimosMeses(datos: PuntoGastoConPromedioMovil[], n: number): number | null {
  if (datos.length === 0) return null;
  const ventana = datos.slice(-n);
  return ventana.reduce((suma, punto) => suma + punto.monto, 0) / ventana.length;
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
 * aparezcan en la leyenda/tooltip igual que las demás series.
 */
export function GastoConPromedioMovilChart({
  datos,
  titulo,
  lado = "gasto",
}: GastoConPromedioMovilChartProps) {
  const esIngreso = lado === "ingreso";
  const colorBarras = esIngreso ? "var(--series-1)" : "var(--series-2)";
  const colorPromedioMovil = esIngreso ? "var(--series-2)" : "var(--series-1)";
  const promedioUltimos3 = useMemo(() => promedioDeUltimosMeses(datos, 3), [datos]);
  const promedioUltimos12 = useMemo(() => promedioDeUltimosMeses(datos, 12), [datos]);
  const datosConPromedios = useMemo(
    () => datos.map((punto) => ({ ...punto, promedioUltimos3, promedioUltimos12 })),
    [datos, promedioUltimos3, promedioUltimos12]
  );

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
          <ComposedChart data={datosConPromedios}>
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
              dataKey="monto"
              name={esIngreso ? "Ingreso mensual" : "Gasto mensual"}
              fill={colorBarras}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
            <Line
              dataKey="promedioMovil"
              name="Promedio móvil (3 meses)"
              stroke={colorPromedioMovil}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              dataKey="promedioUltimos3"
              name="Promedio últimos 3 meses"
              stroke="var(--text-secondary)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
            <Line
              dataKey="promedioUltimos12"
              name="Promedio últimos 12 meses"
              stroke="var(--text-muted)"
              strokeWidth={1.5}
              strokeDasharray="2 6"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
