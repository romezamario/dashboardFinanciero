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
import type { PuntoComercio } from "../lib/queries";

const formateadorMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

interface GastoPorComercioChartProps {
  datos: PuntoComercio[];
  comercioSeleccionado?: string;
  onClickComercio?: (comercio: string) => void;
}

export function GastoPorComercioChart({
  datos,
  comercioSeleccionado,
  onClickComercio,
}: GastoPorComercioChartProps) {
  // Igual que Gasto por categoría: ordenado descendente, más de ~8 comercios
  // se pliegan para no saturar el eje vertical -- pero a diferencia de
  // categoría, aquí no hay un bucket "Otros" clicable ni un "Sin comercio":
  // el comercio es opcional por diseño (solo las reglas que lo definen
  // explícitamente lo asignan), así que las transacciones sin comercio
  // simplemente no entran a esta gráfica en vez de mostrarse como ruido.
  const TOPE = 8;
  const datosFinales = datos.slice(0, TOPE);

  const alturaFila = 32;

  const opacidad = (comercio: string) =>
    !comercioSeleccionado || comercioSeleccionado === comercio ? 1 : 0.3;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Gasto por comercio
        {onClickComercio && (
          <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
            (clic en un comercio para filtrar)
          </span>
        )}
      </h3>
      {datosFinales.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          Ninguna transacción tiene un comercio asignado todavía — agrégalo desde
          "Reglas de categorización..." en la app de escritorio.
        </p>
      ) : (
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
                dataKey="comercio"
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
                  onClickComercio ? (d) => onClickComercio(d.payload.comercio) : undefined
                }
                cursor={onClickComercio ? "pointer" : undefined}
              >
                {datosFinales.map((d) => (
                  <Cell key={d.comercio} fillOpacity={opacidad(d.comercio)} />
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
      )}
    </div>
  );
}
