import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

const OTROS = "Otros";

interface GastoPorCategoriaChartProps {
  datos: PuntoCategoria[];
  categoriaSeleccionada?: string;
  onClickCategoria?: (categoria: string) => void;
}

export function GastoPorCategoriaChart({
  datos,
  categoriaSeleccionada,
  onClickCategoria,
}: GastoPorCategoriaChartProps) {
  // Ordenado descendente, más de ~8 categorías se pliegan en "Otros" para no
  // saturar el eje vertical.
  const TOPE = 8;
  const visibles = datos.slice(0, TOPE);
  const resto = datos.slice(TOPE);
  const otros = resto.reduce((suma, d) => suma + d.total, 0);
  const datosFinales =
    otros > 0 ? [...visibles, { categoria: OTROS, total: otros }] : visibles;

  const alturaFila = 32;

  const opacidad = (categoria: string) =>
    !categoriaSeleccionada || categoriaSeleccionada === categoria ? 1 : 0.3;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Gasto por categoría
        {onClickCategoria && (
          <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
            (clic en una categoría para filtrar)
          </span>
        )}
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
            <Bar
              dataKey="total"
              fill="var(--series-1)"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
              onClick={
                onClickCategoria
                  ? (d) => {
                      // "Otros" agrupa varias categorías reales -- no hay
                      // un solo nombre que filtrar, así que no es clicable.
                      if (d.payload.categoria !== OTROS) {
                        onClickCategoria(d.payload.categoria);
                      }
                    }
                  : undefined
              }
              cursor={onClickCategoria ? "pointer" : undefined}
            >
              {datosFinales.map((d) => (
                <Cell
                  key={d.categoria}
                  fillOpacity={d.categoria === OTROS ? 0.6 : opacidad(d.categoria)}
                />
              ))}
              <LabelList
                dataKey="total"
                position="right"
                formatter={(v: unknown) => formateadorMoneda.format(Number(v))}
                style={{ fill: "var(--text-secondary)", fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
