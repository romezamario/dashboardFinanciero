import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PuntoEvento } from "../lib/queries";
import { useEsMovil } from "../hooks/useEsMovil";
import { truncar } from "../lib/texto";

const formateadorMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

interface GastoPorEventoChartProps {
  datos: PuntoEvento[];
  eventoSeleccionado?: string | null;
  onClickEvento?: (evento: string) => void;
}

/**
 * Mismo patrón que GastoPorComercioChart (barras agrupadas
 * ingresos/gastos, sin fallback "Sin evento" ni "Otros"). A diferencia del
 * Resumen (donde mes/categoría/comercio/cuenta/tarjeta cross-filtran entre
 * sí de forma simétrica), aquí el evento es el filtro que manda: clic en
 * una barra aísla ese evento para el resto de EventosTab (categoría,
 * comercio, tabla), pero nada más filtra de vuelta esta gráfica.
 */
export function GastoPorEventoChart({
  datos,
  eventoSeleccionado,
  onClickEvento,
}: GastoPorEventoChartProps) {
  const TOPE = 8;
  const datosFinales = datos.slice(0, TOPE);

  const alturaFila = 44;
  const esMovil = useEsMovil();
  const anchoEjeY = esMovil ? 84 : 140;
  const margenDerecho = esMovil ? 8 : 48;

  const opacidad = (evento: string) =>
    !eventoSeleccionado || eventoSeleccionado === evento ? 1 : 0.3;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        Ingresos y gastos por evento
        {onClickEvento && (
          <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
            (clic en un evento para ver su detalle)
          </span>
        )}
      </h3>
      {datosFinales.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Ninguna transacción tiene un evento asignado todavía -- selecciona
          transacciones abajo y asígnales uno.
        </p>
      ) : (
        <div style={{ height: Math.max(220, datosFinales.length * alturaFila + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={datosFinales}
              layout="vertical"
              margin={{ left: 8, right: margenDerecho }}
            >
              <CartesianGrid horizontal={false} stroke="var(--gridline)" strokeWidth={1} />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="evento"
                tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={anchoEjeY}
                tickFormatter={(v: string) => (esMovil ? truncar(v, 11) : v)}
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
              <Bar
                dataKey="ingresos"
                name="Ingresos"
                fill="var(--series-1)"
                radius={[0, 4, 4, 0]}
                maxBarSize={16}
                onClick={onClickEvento ? (d) => onClickEvento(d.payload.evento) : undefined}
                cursor={onClickEvento ? "pointer" : undefined}
              >
                {datosFinales.map((d) => (
                  <Cell key={d.evento} fillOpacity={opacidad(d.evento)} />
                ))}
                {!esMovil && (
                  <LabelList
                    dataKey="ingresos"
                    position="right"
                    formatter={(v: unknown) => formateadorMoneda.format(Number(v))}
                    style={{ fill: "var(--text-secondary)", fontSize: 12 }}
                  />
                )}
              </Bar>
              <Bar
                dataKey="gastos"
                name="Gastos"
                fill="var(--series-2)"
                radius={[0, 4, 4, 0]}
                maxBarSize={16}
                onClick={onClickEvento ? (d) => onClickEvento(d.payload.evento) : undefined}
                cursor={onClickEvento ? "pointer" : undefined}
              >
                {datosFinales.map((d) => (
                  <Cell key={d.evento} fillOpacity={opacidad(d.evento)} />
                ))}
                {!esMovil && (
                  <LabelList
                    dataKey="gastos"
                    position="right"
                    formatter={(v: unknown) => formateadorMoneda.format(Number(v))}
                    style={{ fill: "var(--text-secondary)", fontSize: 12 }}
                  />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
