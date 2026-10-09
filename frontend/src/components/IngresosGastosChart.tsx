import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useYAxisScale,
  XAxis,
  YAxis,
} from "recharts";
import { useEsMovil } from "../hooks/useEsMovil";
import type { PuntoIngresoGasto } from "../lib/queries";
import { compacto as formateadorEje, moneda, monedaConCentavos as formateadorTooltip } from "../lib/formato";
import { mesActual, promediosDeGastos } from "../lib/promedios";

/** "recientes" = los últimos 13 meses (mes en curso incluido), la vista por
 * defecto; "meses" = todo el historial mes a mes; "anios" = por año. */
export type VistaTiempo = "recientes" | "meses" | "anios";

interface IngresosGastosChartProps {
  /** Un punto por mes o por año, según `vista`. */
  datos: PuntoIngresoGasto[];
  vista: VistaTiempo;
  onCambiarVista?: (vista: VistaTiempo) => void;
  /** Meses ("2026-06") o años ("2026") del periodo de la vista: se ven
   * completos y el resto se atenúa. Sin él (periodo por defecto), todo
   * igual. */
  resaltados?: Set<string>;
  onClickPeriodo?: (periodo: string) => void;
  /** "Ingresos vs. gastos" por defecto -- las pestañas de Categorías/
   * Comercios lo cambian a "Tendencia de <nombre>" al explorar un elemento
   * puntual. */
  titulo?: string;
  /** Dibuja sobre los gastos el promedio móvil de 3 meses y los promedios de los últimos 3 y 12
   * meses completos, con su nombre y valor en una columna a la derecha (como las etiquetas de
   * soportes y resistencias de QQQ). Solo en la vista por meses; en un teléfono no cabe la
   * columna y los nombres van en la leyenda. */
  conPromedios?: boolean;
}

/** Columna de la derecha: nombre y valor de cada promedio a la altura de su línea. */
const ANCHO_COLUMNA = 184;
const ALTO_ETIQUETA = 30;

interface ItemPromedio {
  nombre: string;
  valor: number;
  color: string;
  trazo?: string;
  ancho: number;
}

/**
 * Etiquetas de los promedios, dentro del SVG de la gráfica y justo a la derecha del área de
 * barras. Usa la escala real del eje Y (`useYAxisScale`) y el área de dibujo (`usePlotArea`), así
 * que cada etiqueta queda a la altura exacta de su línea sin calcular píxeles a mano; si dos
 * quedan muy juntas se separan (con un trazo que las une a su línea).
 */
function EtiquetasPromedios({ items }: { items: ItemPromedio[] }) {
  const escala = useYAxisScale();
  const area = usePlotArea();
  if (!escala || !area) return null;
  const posiciones = items
    .map((item) => ({ item, y: escala(item.valor) }))
    .filter((p): p is { item: ItemPromedio; y: number } => typeof p.y === "number")
    .sort((a, b) => a.y - b.y);
  const ys = posiciones.map((p) => p.y);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + ALTO_ETIQUETA);
  const limite = area.y + area.height - ALTO_ETIQUETA / 2;
  for (let i = ys.length - 1; i >= 0; i--) {
    const tope = i === ys.length - 1 ? limite : ys[i + 1] - ALTO_ETIQUETA;
    ys[i] = Math.min(ys[i], tope);
  }
  const bordeX = area.x + area.width;
  const x = bordeX + 12;
  return (
    <g>
      {posiciones.map(({ item, y }, i) => (
        <g key={item.nombre}>
          {Math.abs(ys[i] - y) > 2 && (
            <line x1={bordeX} y1={y} x2={x - 3} y2={ys[i]} stroke="var(--text-muted)" strokeWidth={1} opacity={0.6} />
          )}
          <line x1={x} x2={x + 14} y1={ys[i]} y2={ys[i]} stroke={item.color} strokeWidth={item.ancho} strokeDasharray={item.trazo} />
          <text x={x + 20} y={ys[i] - 2} fontSize={11} fontWeight={500} fill="var(--text-primary)">
            {item.nombre}
          </text>
          <text x={x + 20} y={ys[i] + 11} fontSize={11} fill="var(--text-muted)">
            {moneda.format(item.valor)}
          </text>
        </g>
      ))}
    </g>
  );
}

export function IngresosGastosChart({
  datos,
  vista,
  onCambiarVista,
  resaltados,
  onClickPeriodo,
  titulo = "Ingresos vs. gastos",
  conPromedios = false,
}: IngresosGastosChartProps) {
  const esMovil = useEsMovil();
  const conLineas = conPromedios && vista !== "anios" && datos.length > 0;
  const columnaAlLado = conLineas && !esMovil;
  const promedios = useMemo(
    () => (conLineas ? promediosDeGastos(datos, mesActual()) : null),
    [conLineas, datos]
  );
  const datosGrafica = useMemo(
    () =>
      promedios
        ? datos.map((d, i) => ({
            ...d,
            promedioMovil: promedios.movil[i],
            promedio3: promedios.ultimos3,
            promedio12: promedios.ultimos12,
          }))
        : datos,
    [datos, promedios]
  );
  // Cuando hay una selección, lo no seleccionado se atenúa en vez de
  // desaparecer -- así se ve qué está filtrado sin perder el eje completo.
  const opacidad = (periodo: string) => (!resaltados || resaltados.has(periodo) ? 1 : 0.3);
  const unidad = vista === "anios" ? "año" : "mes";

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {titulo} por {unidad}
          {onClickPeriodo && (
            <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
              (clic en un {unidad} para verlo como periodo)
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
                ["recientes", "13 meses"],
                ["meses", "Todo"],
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
          <ComposedChart
            data={datosGrafica}
            barGap={2}
            margin={{ top: 5, right: columnaAlLado ? ANCHO_COLUMNA : 5, bottom: 5, left: 5 }}
          >
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
            {promedios && (
              <Line
                dataKey="promedioMovil"
                name="Promedio móvil (3 meses)"
                stroke="var(--series-1)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
                legendType={columnaAlLado ? "none" : "line"}
              />
            )}
            {promedios && (
              <Line
                dataKey="promedio3"
                name="Promedio últimos 3 meses"
                stroke="var(--text-secondary)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                legendType={columnaAlLado ? "none" : "line"}
              />
            )}
            {promedios && (
              <Line
                dataKey="promedio12"
                name="Promedio últimos 12 meses"
                stroke="var(--text-muted)"
                strokeWidth={1.5}
                strokeDasharray="2 6"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                legendType={columnaAlLado ? "none" : "line"}
              />
            )}
            {columnaAlLado && promedios && (
              <EtiquetasPromedios
                items={[
                  ...(promedios.ultimoMovil === null
                    ? []
                    : [{ nombre: "Promedio móvil (3 meses)", valor: promedios.ultimoMovil, color: "var(--series-1)", ancho: 2 }]),
                  ...(promedios.ultimos3 === null
                    ? []
                    : [{ nombre: "Promedio últimos 3 meses", valor: promedios.ultimos3, color: "var(--text-secondary)", ancho: 1.5, trazo: "4 4" }]),
                  ...(promedios.ultimos12 === null
                    ? []
                    : [{ nombre: "Promedio últimos 12 meses", valor: promedios.ultimos12, color: "var(--text-muted)", ancho: 1.5, trazo: "2 6" }]),
                ]}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
