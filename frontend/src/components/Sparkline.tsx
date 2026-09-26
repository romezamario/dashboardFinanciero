import { nombreMes } from "../lib/indicadores";

const moneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

const ANCHO = 96;
const ALTO = 28;
const MARGEN = 3;

interface SparklineProps {
  /** Un valor por mes, en el mismo orden que `meses`. */
  valores: number[];
  meses: string[];
  /** Meses del periodo seleccionado: van en el color de acento; el resto de
   * la línea en el tono de contexto. */
  resaltados: Set<string>;
  /** Nombre de la serie para el lector de pantalla. */
  etiqueta: string;
}

/**
 * Minigráfica de tendencia, estilo cotización bursátil: línea de 12 meses en
 * tono de contexto (gris), con el tramo del periodo seleccionado y el último
 * punto en el color de gastos. La escala va de $0 al máximo de la propia
 * serie -- se compara la forma de cada categoría consigo misma, no el monto
 * entre categorías (para eso están las columnas de montos). Al pasar el
 * mouse por cada mes se ve su monto (tooltip nativo del SVG).
 */
export function Sparkline({ valores, meses, resaltados, etiqueta }: SparklineProps) {
  const maximo = Math.max(...valores, 1);
  const paso = (ANCHO - MARGEN * 2) / Math.max(valores.length - 1, 1);
  const puntos = valores.map((v, i) => ({
    x: MARGEN + i * paso,
    y: ALTO - MARGEN - (v / maximo) * (ALTO - MARGEN * 2),
  }));
  const linea = (pts: typeof puntos) => pts.map((p) => `${p.x},${p.y}`).join(" ");

  // El tramo resaltado arranca en el punto previo al primer mes del periodo,
  // para que el segmento que "entra" al periodo también lleve el acento.
  const primerResaltado = meses.findIndex((m) => resaltados.has(m));
  const tramo = primerResaltado >= 0 ? puntos.slice(Math.max(primerResaltado - 1, 0)) : [];
  const ultimo = puntos[puntos.length - 1];
  const base = ALTO - MARGEN;

  return (
    <svg
      width={ANCHO}
      height={ALTO}
      viewBox={`0 0 ${ANCHO} ${ALTO}`}
      role="img"
      aria-label={`Tendencia de ${etiqueta}: ${meses
        .map((m, i) => `${nombreMes(m, true)} ${moneda.format(valores[i])}`)
        .join(", ")}`}
      style={{ display: "inline-block", verticalAlign: "middle", overflow: "visible" }}
    >
      <polygon
        points={`${MARGEN},${base} ${linea(puntos)} ${ultimo.x},${base}`}
        fill="var(--series-2)"
        fillOpacity={0.1}
      />
      <polyline
        points={linea(puntos)}
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {tramo.length > 1 && (
        <polyline
          points={linea(tramo)}
          fill="none"
          stroke="var(--series-2)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <circle
        cx={ultimo.x}
        cy={ultimo.y}
        r={2.5}
        fill="var(--series-2)"
        stroke="var(--surface-1)"
        strokeWidth={1.5}
      />
      {/* Zonas invisibles por mes, más anchas que el trazo, para el tooltip. */}
      {puntos.map((p, i) => (
        <rect key={meses[i]} x={p.x - paso / 2} y={0} width={paso} height={ALTO} fill="transparent">
          <title>{`${nombreMes(meses[i], true)}: ${moneda.format(valores[i])}`}</title>
        </rect>
      ))}
    </svg>
  );
}
