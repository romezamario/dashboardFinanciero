import { usePlotArea, useYAxisScale } from "recharts";
import { moneda } from "../lib/formato";
import { ALTO_ETIQUETA_PROMEDIO } from "../lib/promedios";

/** Una línea de promedio de la gráfica: lo que se escribe en la columna de la derecha. */
export interface ItemPromedio {
  nombre: string;
  valor: number;
  color: string;
  /** `strokeDasharray` de la línea (ninguno = continua); se repite en la muestra de la etiqueta. */
  trazo?: string;
  ancho: number;
}

/**
 * Etiquetas de los promedios, dentro del SVG de la gráfica y justo a la derecha del área de
 * barras (el mismo estilo de las etiquetas de soportes y resistencias de QQQ). Usa la escala
 * real del eje Y (`useYAxisScale`) y el área de dibujo (`usePlotArea`), así que cada etiqueta
 * queda a la altura exacta de su línea sin calcular píxeles a mano; si dos quedan muy juntas
 * se separan (con un trazo que las une a su línea). La gráfica debe reservar
 * `ANCHO_COLUMNA_PROMEDIOS` de margen derecho. Va como hijo de la gráfica de Recharts.
 */
export function EtiquetasPromedios({ items }: { items: ItemPromedio[] }) {
  const escala = useYAxisScale();
  const area = usePlotArea();
  if (!escala || !area) return null;
  const posiciones = items
    .map((item) => ({ item, y: escala(item.valor) }))
    .filter((p): p is { item: ItemPromedio; y: number } => typeof p.y === "number")
    .sort((a, b) => a.y - b.y);
  const ys = posiciones.map((p) => p.y);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + ALTO_ETIQUETA_PROMEDIO);
  const limite = area.y + area.height - ALTO_ETIQUETA_PROMEDIO / 2;
  for (let i = ys.length - 1; i >= 0; i--) {
    const tope = i === ys.length - 1 ? limite : ys[i + 1] - ALTO_ETIQUETA_PROMEDIO;
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
