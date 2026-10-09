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
import type { PuntoDimension } from "../lib/queries";
import { useEsMovil } from "../hooks/useEsMovil";
import { truncar } from "../lib/texto";
import { moneda } from "../lib/formato";

const OTROS = "Otros";
/** Más de ~8 barras saturan el eje vertical. */
const TOPE = 8;

interface IngresosGastosPorDimensionChartProps {
  /** "categoría", "comercio", "evento" -- arma el título y la ayuda. */
  dimension: string;
  datos: PuntoDimension[];
  seleccionado?: string | null;
  onClickElemento?: (nombre: string) => void;
  /** Texto junto al título cuando hay clic, p. ej. "clic en un evento para
   * ver su detalle". */
  ayudaClic?: string;
  /** Lo que se muestra sin datos; sin él se dibuja la gráfica vacía. */
  mensajeVacio?: string;
  /** Pliega lo que pase del top-8 en una barra "Otros" no clicable (solo
   * categoría: comercio y evento son opcionales, el resto simplemente no se
   * muestra). */
  plegarResto?: boolean;
}

/**
 * Barras horizontales agrupadas de ingresos (azul) y gastos (naranja) por
 * dimensión, ordenadas por magnitud combinada (ver `agruparPor`). Clic en
 * una barra = cross-filter; las no seleccionadas se atenúan a 0.3.
 */
export function IngresosGastosPorDimensionChart({
  dimension,
  datos,
  seleccionado,
  onClickElemento,
  ayudaClic,
  mensajeVacio,
  plegarResto = false,
}: IngresosGastosPorDimensionChartProps) {
  const visibles = datos.slice(0, TOPE);
  let datosFinales = visibles;
  if (plegarResto) {
    const resto = datos.slice(TOPE);
    const ingresos = resto.reduce((suma, d) => suma + d.ingresos, 0);
    const gastos = resto.reduce((suma, d) => suma + d.gastos, 0);
    if (ingresos + gastos > 0) datosFinales = [...visibles, { nombre: OTROS, ingresos, gastos }];
  }

  const alturaFila = 44;
  const esMovil = useEsMovil();
  // El eje Y (nombres) y el margen derecho (etiquetas de monto) son props
  // numéricos de Recharts, no clases de Tailwind -- en un teléfono se
  // encogen a mano para dejarle más ancho real a las barras.
  const anchoEjeY = esMovil ? 84 : 140;
  const margenDerecho = esMovil ? 8 : 48;

  // "Otros" agrupa varios nombres reales -- no hay uno solo que filtrar.
  const esOtros = (nombre: string) => plegarResto && nombre === OTROS;
  const opacidad = (nombre: string) =>
    esOtros(nombre) ? 0.6 : !seleccionado || seleccionado === nombre ? 1 : 0.3;
  const alClic = onClickElemento
    ? (d: { payload?: PuntoDimension }) => {
        const nombre = d.payload?.nombre;
        if (nombre && !esOtros(nombre)) onClickElemento(nombre);
      }
    : undefined;

  const barra = (dataKey: "ingresos" | "gastos", name: string, color: string) => (
    <Bar
      dataKey={dataKey}
      name={name}
      fill={color}
      radius={[0, 4, 4, 0]}
      maxBarSize={16}
      onClick={alClic}
      cursor={onClickElemento ? "pointer" : undefined}
    >
      {datosFinales.map((d) => (
        <Cell key={d.nombre} fillOpacity={opacidad(d.nombre)} />
      ))}
      {/* Sin espacio para el monto al final de la barra en móvil: basta con
          tocar la barra para verlo en el tooltip. */}
      {!esMovil && (
        <LabelList
          dataKey={dataKey}
          position="right"
          formatter={(v: unknown) => moneda.format(Number(v))}
          style={{ fill: "var(--text-secondary)", fontSize: 12 }}
        />
      )}
    </Bar>
  );

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        Ingresos y gastos por {dimension}
        {onClickElemento && (
          <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
            ({ayudaClic ?? `clic en ${dimension === "categoría" ? "una" : "un"} ${dimension} para filtrar`})
          </span>
        )}
      </h3>
      {datosFinales.length === 0 && mensajeVacio ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {mensajeVacio}
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
                dataKey="nombre"
                tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={anchoEjeY}
                tickFormatter={(v: string) => (esMovil ? truncar(v, 11) : v)}
              />
              <Tooltip
                formatter={(value) => moneda.format(Number(value))}
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
              {barra("ingresos", "Ingresos", "var(--series-1)")}
              {barra("gastos", "Gastos", "var(--series-2)")}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
