import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { colorTarjeta, OTRAS_CATEGORIAS, type FilaPorTarjeta } from "../lib/tarjetas";
import { truncar } from "../lib/texto";
import { useEsMovil } from "../hooks/useEsMovil";
import { moneda, compacto, porcentaje } from "../lib/formato";
import { estiloTooltip } from "../lib/estilos";


function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-4 tarjeta"
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {titulo}
      </h3>
      {children}
    </div>
  );
}

/** Suma de las columnas de tarjeta de una fila (mes o categoría). */
function totalFila(fila: FilaPorTarjeta, tarjetas: string[]): number {
  return tarjetas.reduce((s, t) => s + Number(fila[t] ?? 0), 0);
}

/** Tooltip con monto y porcentaje de cada tarjeta dentro de la fila (el
 * mes o la categoría), más el total -- el porcentaje responde "qué parte
 * de esto fue con cada tarjeta". */
function TooltipPorTarjeta({
  active,
  payload,
  tarjetas,
}: {
  active?: boolean;
  payload?: { payload: FilaPorTarjeta }[];
  tarjetas: string[];
}) {
  if (!active || !payload?.length) return null;
  const fila = payload[0].payload;
  const total = totalFila(fila, tarjetas);
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={estiloTooltip}>
      <div className="mb-1 font-medium">{fila.etiqueta}</div>
      {tarjetas.map((tarjeta, i) => {
        const monto = Number(fila[tarjeta] ?? 0);
        if (monto === 0) return null;
        return (
          <div key={tarjeta} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colorTarjeta(i) }} />
            <span>{tarjeta}:</span>
            <span style={{ color: "var(--text-secondary)" }}>
              {moneda.format(monto)} ({porcentaje.format(total > 0 ? monto / total : 0)})
            </span>
          </div>
        );
      })}
      <div className="mt-1 font-medium">Total: {moneda.format(total)}</div>
    </div>
  );
}

// Etiqueta de porcentaje dentro de un tramo apilado. Solo se pinta si el
// tramo es lo bastante grande para que el texto quepa y se lea (umbral en
// píxeles y en % del total), así no hay un número encimado en cada barra.
// Texto casi negro en todos los tramos: medido contra los 4 rellenos en
// ambos modos, da >= 4.5:1 en todos (el blanco bajaba hasta 2.2:1 sobre el
// amarillo claro). El color del texto lo decide el contraste con el relleno,
// no la identidad de la serie.
const TEXTO_SOBRE_TRAMO = "#0b0b0b";
const PROPORCION_MINIMA_ETIQUETA = 0.12;

function etiquetaPorcentajeEnTramo(
  indiceTarjeta: number,
  datos: FilaPorTarjeta[],
  tarjetas: string[],
  resaltados: Set<string>
) {
  const porEtiqueta = new Map(datos.map((fila) => [fila.etiqueta, fila]));
  return function Etiqueta(props: PropsEtiqueta) {
    const fila = porEtiqueta.get(String(props.value));
    const x = Number(props.x ?? 0), y = Number(props.y ?? 0);
    const ancho = Number(props.width ?? 0), alto = Number(props.height ?? 0);
    if (!fila || !resaltados.has(fila.etiqueta) || alto < 14 || ancho < 22) return null;
    const total = totalFila(fila, tarjetas);
    const proporcion = total > 0 ? Number(fila[tarjetas[indiceTarjeta]] ?? 0) / total : 0;
    if (proporcion < PROPORCION_MINIMA_ETIQUETA) return null;
    return (
      <text
        x={x + ancho / 2}
        y={y + alto / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={600}
        fill={TEXTO_SOBRE_TRAMO}
      >
        {porcentaje.format(proporcion)}
      </text>
    );
  };
}

// Recharts descarta las barras de tamaño cero ANTES de pasarlas a
// <LabelList>, así que el `index` que llega al `content` es la posición en esa
// lista filtrada, no en `datos` -- una tarjeta con $0 en algún mes corría todas
// las etiquetas siguientes a la fila equivocada (o las perdía). En vez de
// confiar en el índice, cada etiqueta recibe como `value` la `etiqueta` de su
// propia fila (mes o categoría) y la busca por nombre.
const etiquetaDeFila = (entrada: unknown) =>
  (entrada as { payload?: FilaPorTarjeta }).payload?.etiqueta ?? "";

interface PropsEtiqueta {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: unknown;
}

const leyenda = (value: string) => (
  <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{value}</span>
);

/** Opacidad de lo NO seleccionado: se atenúa en vez de ocultarse, igual que
 * el cross-filter del Resumen, para no perder la forma completa. */
const ATENUADO = 0.3;

const opacidadTarjeta = (tarjeta: string, seleccionada?: string) =>
  !seleccionada || seleccionada === tarjeta ? 1 : ATENUADO;

/** Clic en la leyenda = filtrar por esa tarjeta. */
const clicLeyenda =
  (onClickTarjeta?: (tarjeta: string) => void) => (entrada: { dataKey?: unknown }) => {
    if (onClickTarjeta && typeof entrada.dataKey === "string") onClickTarjeta(entrada.dataKey);
  };

/** Parte de cada tarjeta en el gasto del periodo: una sola barra al 100%
 * con etiquetas directas debajo (nombre, % y monto), no solo color. */
export function DistribucionGastoTarjetas({
  tarjetas,
  gastos,
  tarjetaSeleccionada,
  onClickTarjeta,
}: {
  tarjetas: string[];
  gastos: number[];
  tarjetaSeleccionada?: string;
  onClickTarjeta?: (tarjeta: string) => void;
}) {
  const total = gastos.reduce((s, g) => s + g, 0);
  return (
    <Tarjeta titulo="Cómo se reparte tu gasto entre tarjetas (clic en una tarjeta para filtrar)">
      {total === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Sin gasto con tarjeta en el periodo.
        </p>
      ) : (
        <>
          <div className="mt-3 flex h-6 w-full gap-0.5 overflow-hidden rounded">
            {tarjetas.map((tarjeta, i) =>
              gastos[i] > 0 ? (
                <button
                  key={tarjeta}
                  type="button"
                  onClick={() => onClickTarjeta?.(tarjeta)}
                  title={`${tarjeta}: ${moneda.format(gastos[i])} (${porcentaje.format(gastos[i] / total)})`}
                  aria-pressed={tarjetaSeleccionada === tarjeta}
                  style={{
                    width: `${(gastos[i] / total) * 100}%`,
                    background: colorTarjeta(i),
                    opacity: opacidadTarjeta(tarjeta, tarjetaSeleccionada),
                    cursor: onClickTarjeta ? "pointer" : undefined,
                  }}
                />
              ) : null
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {tarjetas.map((tarjeta, i) => (
              <button
                key={tarjeta}
                type="button"
                onClick={() => onClickTarjeta?.(tarjeta)}
                aria-pressed={tarjetaSeleccionada === tarjeta}
                className="flex items-center gap-1.5"
                style={{ opacity: opacidadTarjeta(tarjeta, tarjetaSeleccionada) }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: colorTarjeta(i) }}
                />
                <span
                  style={{
                    color: "var(--text-primary)",
                    fontWeight: tarjetaSeleccionada === tarjeta ? 600 : undefined,
                  }}
                >
                  {tarjeta}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {porcentaje.format(gastos[i] / total)} · {moneda.format(gastos[i])}
                </span>
              </button>
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
  tarjetaSeleccionada,
  onClickMes,
  onClickTarjeta,
}: {
  datos: FilaPorTarjeta[];
  tarjetas: string[];
  resaltados: Set<string>;
  tarjetaSeleccionada?: string;
  /** Clic en un mes = ese mes pasa a ser el periodo (como en el Resumen). */
  onClickMes?: (mes: string) => void;
  /** Clic en la leyenda = filtrar por esa tarjeta. */
  onClickTarjeta?: (tarjeta: string) => void;
}) {
  return (
    <Tarjeta titulo="Gasto mensual por tarjeta, últimos 12 meses (periodo resaltado; % = parte de cada tarjeta en el mes; clic en un mes para verlo como periodo)">
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
              content={<TooltipPorTarjeta tarjetas={tarjetas} />}
            />
            <Legend
              formatter={leyenda}
              onClick={clicLeyenda(onClickTarjeta)}
              wrapperStyle={{ cursor: onClickTarjeta ? "pointer" : undefined }}
            />
            {tarjetas.map((tarjeta, i) => (
              <Bar
                key={tarjeta}
                dataKey={tarjeta}
                stackId="gasto"
                onClick={onClickMes ? (d) => onClickMes(d.payload.etiqueta) : undefined}
                cursor={onClickMes ? "pointer" : undefined}
                fill={colorTarjeta(i)}
                // Separador de 1px en el color de la superficie entre
                // segmentos apilados, para que no se fundan entre sí.
                stroke="var(--surface-1)"
                strokeWidth={1}
                radius={i === tarjetas.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={32}
              >
                {datos.map((d) => (
                  <Cell
                    key={d.etiqueta}
                    fillOpacity={
                      resaltados.has(d.etiqueta) &&
                      opacidadTarjeta(tarjeta, tarjetaSeleccionada) === 1
                        ? 1
                        : ATENUADO
                    }
                  />
                ))}
                <LabelList
                  valueAccessor={etiquetaDeFila}
                  content={
                    opacidadTarjeta(tarjeta, tarjetaSeleccionada) === 1
                      ? etiquetaPorcentajeEnTramo(i, datos, tarjetas, resaltados)
                      : () => null
                  }
                />
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
  categoriaSeleccionada,
  onClickCategoria,
  onClickTarjeta,
}: {
  datos: FilaPorTarjeta[];
  tarjetas: string[];
  categoriaSeleccionada?: string;
  /** Clic en una barra = filtrar por esa categoría ("Otras" no es
   * clickeable: no corresponde a una sola categoría real). */
  onClickCategoria?: (categoria: string) => void;
  onClickTarjeta?: (tarjeta: string) => void;
}) {
  const esMovil = useEsMovil();
  const totalPeriodo = datos.reduce((s, fila) => s + totalFila(fila, tarjetas), 0);
  // Al final de cada barra: monto de la categoría y qué parte es del gasto
  // con tarjeta del periodo. Una sola etiqueta por barra, colgada del ÚLTIMO
  // tramo con monto de esa fila (donde termina la pila) -- no del último de
  // la lista, que puede ser $0 en esa categoría y entonces no se dibuja.
  const porEtiqueta = new Map(datos.map((fila) => [fila.etiqueta, fila]));
  const etiquetaTotal = (indiceTarjeta: number) => (props: PropsEtiqueta) => {
    const fila = porEtiqueta.get(String(props.value));
    if (!fila || totalPeriodo === 0) return null;
    const ultimaConMonto = tarjetas.reduce(
      (ultima, t, i) => (Number(fila[t] ?? 0) > 0 ? i : ultima),
      -1
    );
    if (ultimaConMonto !== indiceTarjeta) return null;
    const total = totalFila(fila, tarjetas);
    return (
      <text
        x={Number(props.x ?? 0) + Number(props.width ?? 0) + 6}
        y={Number(props.y ?? 0) + Number(props.height ?? 0) / 2}
        dominantBaseline="central"
        fontSize={11}
        fill="var(--text-secondary)"
      >
        {esMovil
          ? porcentaje.format(total / totalPeriodo)
          : `${compacto.format(total)} · ${porcentaje.format(total / totalPeriodo)}`}
      </text>
    );
  };
  return (
    <Tarjeta titulo="Para qué usas cada tarjeta (gasto del periodo por categoría; % del gasto con tarjeta; clic en una categoría para filtrar)">
      {datos.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Sin gasto con tarjeta en el periodo.
        </p>
      ) : (
        <div className="mt-3" style={{ height: Math.max(datos.length * 40, 120) + 60 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datos} layout="vertical" margin={{ left: 0, right: esMovil ? 40 : 88 }}>
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
                content={<TooltipPorTarjeta tarjetas={tarjetas} />}
              />
              <Legend
                formatter={leyenda}
                onClick={clicLeyenda(onClickTarjeta)}
                wrapperStyle={{ cursor: onClickTarjeta ? "pointer" : undefined }}
              />
              {tarjetas.map((tarjeta, i) => (
                <Bar
                  key={tarjeta}
                  dataKey={tarjeta}
                  stackId="categoria"
                  onClick={
                    onClickCategoria
                      ? (d) => {
                          const categoria = d.payload.etiqueta as string;
                          if (categoria !== OTRAS_CATEGORIAS) onClickCategoria(categoria);
                        }
                      : undefined
                  }
                  cursor={onClickCategoria ? "pointer" : undefined}
                  fill={colorTarjeta(i)}
                  stroke="var(--surface-1)"
                  strokeWidth={1}
                  radius={i === tarjetas.length - 1 ? [0, 4, 4, 0] : 0}
                  maxBarSize={22}
                >
                  {datos.map((d) => (
                    <Cell
                      key={d.etiqueta}
                      fillOpacity={
                        !categoriaSeleccionada || categoriaSeleccionada === d.etiqueta ? 1 : ATENUADO
                      }
                    />
                  ))}
                  <LabelList valueAccessor={etiquetaDeFila} content={etiquetaTotal(i)} />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Tarjeta>
  );
}
