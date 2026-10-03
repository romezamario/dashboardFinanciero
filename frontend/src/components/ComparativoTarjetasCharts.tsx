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
import { colorTarjeta, type FilaPorTarjeta } from "../lib/tarjetas";
import { truncar } from "../lib/texto";
import { useEsMovil } from "../hooks/useEsMovil";

const moneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});
const compacto = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });
const porcentaje = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });

const estiloTooltip = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
};

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {titulo}
      </h3>
      {children}
    </div>
  );
}

const leyenda = (value: string) => (
  <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{value}</span>
);

/** Parte de cada tarjeta en el gasto del periodo: una sola barra al 100%
 * con etiquetas directas debajo (nombre, % y monto), no solo color. */
export function DistribucionGastoTarjetas({
  tarjetas,
  gastos,
}: {
  tarjetas: string[];
  gastos: number[];
}) {
  const total = gastos.reduce((s, g) => s + g, 0);
  return (
    <Tarjeta titulo="Cómo se reparte tu gasto entre tarjetas">
      {total === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Sin gasto con tarjeta en el periodo.
        </p>
      ) : (
        <>
          <div className="mt-3 flex h-6 w-full gap-0.5 overflow-hidden rounded">
            {tarjetas.map((tarjeta, i) =>
              gastos[i] > 0 ? (
                <div
                  key={tarjeta}
                  title={`${tarjeta}: ${moneda.format(gastos[i])} (${porcentaje.format(gastos[i] / total)})`}
                  style={{ width: `${(gastos[i] / total) * 100}%`, background: colorTarjeta(i) }}
                />
              ) : null
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {tarjetas.map((tarjeta, i) => (
              <span key={tarjeta} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: colorTarjeta(i) }}
                />
                <span style={{ color: "var(--text-primary)" }}>{tarjeta}</span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {porcentaje.format(gastos[i] / total)} · {moneda.format(gastos[i])}
                </span>
              </span>
            ))}
          </div>
        </>
      )}
    </Tarjeta>
  );
}

/** Gasto mensual apilado por tarjeta. Los meses del periodo elegido se ven
 * completos y el resto se atenúa (mismo recurso que en el Resumen). */
export function GastoMensualPorTarjetaChart({
  datos,
  tarjetas,
  resaltados,
}: {
  datos: FilaPorTarjeta[];
  tarjetas: string[];
  resaltados: Set<string>;
}) {
  return (
    <Tarjeta titulo="Gasto mensual por tarjeta, últimos 12 meses (periodo resaltado)">
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
            <XAxis
              dataKey="etiqueta"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={{ stroke: "var(--baseline)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => compacto.format(v)}
            />
            <Tooltip
              cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
              formatter={(value) => moneda.format(Number(value))}
              contentStyle={estiloTooltip}
            />
            <Legend formatter={leyenda} />
            {tarjetas.map((tarjeta, i) => (
              <Bar
                key={tarjeta}
                dataKey={tarjeta}
                stackId="gasto"
                fill={colorTarjeta(i)}
                // Separador de 1px en el color de la superficie entre
                // segmentos apilados, para que no se fundan entre sí.
                stroke="var(--surface-1)"
                strokeWidth={1}
                radius={i === tarjetas.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={32}
              >
                {datos.map((d) => (
                  <Cell key={d.etiqueta} fillOpacity={resaltados.has(d.etiqueta) ? 1 : 0.3} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Tarjeta>
  );
}

/** Para qué usas cada tarjeta: gasto del periodo por categoría, partido por
 * tarjeta (barras horizontales apiladas). */
export function CategoriaPorTarjetaChart({
  datos,
  tarjetas,
}: {
  datos: FilaPorTarjeta[];
  tarjetas: string[];
}) {
  const esMovil = useEsMovil();
  return (
    <Tarjeta titulo="Para qué usas cada tarjeta (gasto del periodo por categoría)">
      {datos.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Sin gasto con tarjeta en el periodo.
        </p>
      ) : (
        <div className="mt-3" style={{ height: Math.max(datos.length * 40, 120) + 60 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datos} layout="vertical" margin={{ left: 0, right: esMovil ? 8 : 24 }}>
              <CartesianGrid horizontal={false} stroke="var(--gridline)" strokeWidth={1} />
              <XAxis
                type="number"
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => compacto.format(v)}
              />
              <YAxis
                type="category"
                dataKey="etiqueta"
                width={esMovil ? 84 : 140}
                tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                axisLine={{ stroke: "var(--baseline)" }}
                tickLine={false}
                tickFormatter={(v: string) => (esMovil ? truncar(v, 11) : v)}
              />
              <Tooltip
                cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
                formatter={(value) => moneda.format(Number(value))}
                contentStyle={estiloTooltip}
              />
              <Legend formatter={leyenda} />
              {tarjetas.map((tarjeta, i) => (
                <Bar
                  key={tarjeta}
                  dataKey={tarjeta}
                  stackId="categoria"
                  fill={colorTarjeta(i)}
                  stroke="var(--surface-1)"
                  strokeWidth={1}
                  radius={i === tarjetas.length - 1 ? [0, 4, 4, 0] : 0}
                  maxBarSize={22}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Tarjeta>
  );
}
