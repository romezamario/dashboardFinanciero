import type { MouseEvent as EventoRaton, ReactNode } from "react";
import { ReferenceArea, ReferenceDot, ReferenceLine } from "recharts";
import type { NivelTecnico } from "../lib/tecnico";
import type { Calidad, Patron, PuntoClave, Segmento } from "../lib/patrones";

// Lo que se dibuja de los patrones sobre la gráfica de precio (elementos de
// Recharts) y los formatos que comparten con el panel (PanelPatrones.tsx).
// La detección vive en lib/patrones; aquí solo se presenta.

const COLOR_ALCISTA = "var(--series-1)";
const COLOR_BAJISTA = "var(--series-2)";
const COLOR_NEUTRAL = "var(--text-secondary)";

export const colorDeSesgo = (p: Patron) =>
  p.sesgo === "alcista" ? COLOR_ALCISTA : p.sesgo === "bajista" ? COLOR_BAJISTA : COLOR_NEUTRAL;

export const precio2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const volumenCompacto = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

export function fechaCorta(fecha: string): string {
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const ETIQUETA_CALIDAD: Record<Calidad, string> = { alta: "calidad alta", media: "calidad media", baja: "calidad baja" };
/** La calidad se dice con palabras y con la forma del punto, no solo con color. */
export const RELLENO_CALIDAD: Record<Calidad, string> = { alta: "●", media: "◐", baja: "○" };

export type Seleccion = { tipo: "patron"; patron: Patron } | { tipo: "nivel"; nivel: NivelTecnico };

export interface EventosPatron {
  alEntrar: (patron: Patron, e: EventoRaton) => void;
  alSalir: () => void;
  alHacerClic: (patron: Patron, e: EventoRaton) => void;
}

/** ¿Va la etiqueta del punto arriba o abajo de él? Máximos arriba, mínimos abajo. */
function etiquetaArriba(p: PuntoClave): boolean {
  if (p.precio >= p.vela.maximo - 1e-9) return true;
  if (p.precio <= p.vela.minimo + 1e-9) return false;
  return p.precio >= (p.vela.maximo + p.vela.minimo) / 2;
}

const ESTILO_SEGMENTO: Record<
  Segmento["estilo"],
  { ancho: number; trazo?: string; opacidad: number; posicion: "insideTopRight" | "insideBottomRight" | "insideTopLeft" | "insideBottom" }
> = {
  neckline: { ancho: 1.75, opacidad: 0.95, posicion: "insideBottomRight" },
  guia: { ancho: 1, opacidad: 0.5, posicion: "insideTopRight" },
  ajuste: { ancho: 1, trazo: "2 3", opacidad: 0.7, posicion: "insideTopRight" },
  mastil: { ancho: 2.25, opacidad: 0.9, posicion: "insideTopLeft" },
  objetivo: { ancho: 1.25, trazo: "6 4", opacidad: 0.9, posicion: "insideTopRight" },
  llave: { ancho: 1, opacidad: 0.8, posicion: "insideBottom" },
};

/**
 * Elementos de Recharts (sombreados, líneas, puntos con etiqueta y una
 * insignia con el nombre y la calidad) de los patrones activos, para ponerlos
 * dentro del ComposedChart del precio. Las posiciones salen de las fechas y
 * precios de los pivotes/velas que originan cada patrón (nada a ojo). Cada
 * punto y la insignia abren la tarjeta del patrón al pasar el ratón o al hacer
 * clic.
 */
export function elementosDePatrones(
  patrones: Patron[],
  eventos: EventosPatron,
  resaltadoId: string | null,
  totalVelas: number
): ReactNode[] {
  const salida: ReactNode[] = [];
  for (const [indice, patron] of patrones.entries()) {
    const color = colorDeSesgo(patron);
    const grosor = resaltadoId === patron.id ? 1.6 : 1;
    const manejadores = {
      onMouseEnter: (e: EventoRaton) => eventos.alEntrar(patron, e),
      onMouseLeave: () => eventos.alSalir(),
      onClick: (e: EventoRaton) => eventos.alHacerClic(patron, e),
    };

    patron.zonas.forEach((z, i) => {
      salida.push(
        <ReferenceArea
          key={`${patron.id}-z${i}`}
          x1={z.desdeFecha}
          x2={z.hastaFecha}
          y1={z.minimo}
          y2={z.maximo}
          fill={color}
          fillOpacity={0.1}
          stroke={color}
          strokeOpacity={0.45}
          strokeDasharray="3 3"
          ifOverflow="hidden"
          label={z.etiqueta ? { value: z.etiqueta, position: "insideTopLeft", fill: "var(--text-secondary)", fontSize: 10 } : undefined}
        />
      );
    });

    patron.segmentos.forEach((s, i) => {
      const estilo = ESTILO_SEGMENTO[s.estilo];
      salida.push(
        <ReferenceLine
          key={`${patron.id}-s${i}`}
          segment={[
            { x: s.desde.fecha, y: s.desde.precio },
            { x: s.hasta.fecha, y: s.hasta.precio },
          ]}
          stroke={s.estilo === "objetivo" || s.estilo === "llave" ? "var(--text-secondary)" : "var(--text-primary)"}
          strokeWidth={estilo.ancho * grosor}
          strokeDasharray={estilo.trazo}
          strokeOpacity={estilo.opacidad}
          ifOverflow="hidden"
          label={
            s.etiqueta
              ? { value: s.etiqueta, position: estilo.posicion, fill: "var(--text-secondary)", fontSize: 10 }
              : undefined
          }
        />
      );
    });

    patron.puntos.forEach((pt, i) => {
      const arriba = etiquetaArriba(pt);
      salida.push(
        <ReferenceDot
          key={`${patron.id}-p${i}`}
          x={pt.fecha}
          y={pt.precio}
          ifOverflow="hidden"
          shape={(props: unknown) => {
            const { cx, cy } = props as { cx?: number; cy?: number };
            if (cx == null || cy == null) return <g />;
            return (
              <g style={{ cursor: "pointer" }} {...manejadores}>
                <circle cx={cx} cy={cy} r={3.5} fill="var(--surface-1)" stroke={color} strokeWidth={2} />
                {!pt.silencioso && (
                  <text
                    x={cx}
                    y={arriba ? cy - 8 : cy + 16}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--text-primary)"
                    stroke="var(--surface-1)"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {pt.etiqueta}
                  </text>
                )}
                <title>{`${pt.etiqueta}: ${fechaCorta(pt.fecha)} · ${precio2.format(pt.precio)}`}</title>
              </g>
            );
          }}
        />
      );
    });

    // Insignia con el nombre y la calidad, sobre el punto más alto (escalonadas
    // en 3 alturas para que dos patrones cercanos no se tapen).
    const tope = patron.puntos.reduce((m, p) => (p.precio > m.precio ? p : m), patron.puntos[0]);
    const texto = `${patron.nombre} · ${ETIQUETA_CALIDAD[patron.calidad]}`;
    salida.push(
      <ReferenceDot
        key={`${patron.id}-insignia`}
        x={patron.fechaInicio}
        y={tope.precio}
        ifOverflow="hidden"
        shape={(props: unknown) => {
          const { cx, cy } = props as { cx?: number; cy?: number };
          if (cx == null || cy == null) return <g />;
          const ancho = texto.length * 5.4 + 22;
          // Hacia el final de la serie la insignia se alinea a la derecha del punto:
          // si no, se saldría de la gráfica.
          const haciaLaIzquierda = patron.indiceInicio / Math.max(1, totalVelas) > 0.55;
          return (
            <g style={{ cursor: "pointer" }} {...manejadores} transform={`translate(${haciaLaIzquierda ? cx - ancho + 8 : cx}, ${cy - 34 - (indice % 3) * 19})`}>
              <rect width={ancho} height={17} rx={4} fill="var(--surface-1)" stroke={color} strokeWidth={1.25} />
              <text x={7} y={12} fontSize={10} fill="var(--text-primary)">
                <tspan fill={color}>{RELLENO_CALIDAD[patron.calidad]}</tspan> {texto}
              </text>
            </g>
          );
        }}
      />
    );
  }
  return salida;
}

