import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import type { SankeyLinkProps, SankeyNodeProps } from "recharts";
import type { FlujoSankeyDatos } from "../lib/indicadores";

const formateadorMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

// Mismos dos tonos ya validados del resto del dashboard (azul = ingresos,
// naranja = gastos) -- ver la nota de "Chart colors/specs" en CLAUDE.md:
// las gráficas de magnitud por categoría usan un solo hue, no colores
// categóricos, porque las etiquetas ya cargan la identidad.
const COLOR_INGRESO = "var(--series-1)";
const COLOR_GASTO = "var(--series-2)";

interface NodoSankey {
  name: string;
  color: string;
}

interface EnlaceSankey {
  source: number;
  target: number;
  value: number;
}

/**
 * Arma nodos/enlaces balanceados a partir del desglose de calcularFlujoSankey:
 * categorías de ingreso -> "Ingresos totales" -> {"Ahorro", "Gastos totales"}
 * -> categorías de gasto. Si se gastó más de lo que entró (ahorro < 0), un
 * nodo "Déficit" aporta la diferencia directo a "Gastos totales" en vez de
 * dejar ese nodo con más salida que entrada -- un Sankey no tiene forma de
 * representar "de dónde salió" ese exceso más que nombrándolo.
 */
function construirDatosSankey(datos: FlujoSankeyDatos): { nodes: NodoSankey[]; links: EnlaceSankey[] } {
  const nodes: NodoSankey[] = [];
  const links: EnlaceSankey[] = [];
  const agregarNodo = (name: string, color: string) => nodes.push({ name, color }) - 1;

  let idIngresosTotales: number | null = null;
  if (datos.ingresos.length > 0) {
    idIngresosTotales = agregarNodo("Ingresos totales", COLOR_INGRESO);
    for (const { categoria, monto } of datos.ingresos) {
      const id = agregarNodo(categoria, COLOR_INGRESO);
      links.push({ source: id, target: idIngresosTotales, value: monto });
    }
  }

  if (datos.gastos.length > 0) {
    const idGastosTotales = agregarNodo("Gastos totales", COLOR_GASTO);

    const ahorro = Math.max(0, datos.ahorro);
    const deficit = Math.max(0, -datos.ahorro);
    const flujoDeIngresos = Math.min(datos.totalIngresos, datos.totalGastos);

    if (idIngresosTotales !== null) {
      if (ahorro > 0) {
        const idAhorro = agregarNodo("Ahorro", COLOR_INGRESO);
        links.push({ source: idIngresosTotales, target: idAhorro, value: ahorro });
      }
      if (flujoDeIngresos > 0) {
        links.push({ source: idIngresosTotales, target: idGastosTotales, value: flujoDeIngresos });
      }
    }
    if (deficit > 0) {
      const idDeficit = agregarNodo("Déficit", COLOR_GASTO);
      links.push({ source: idDeficit, target: idGastosTotales, value: deficit });
    }

    for (const { categoria, monto } of datos.gastos) {
      const id = agregarNodo(categoria, COLOR_GASTO);
      links.push({ source: idGastosTotales, target: id, value: monto });
    }
  }

  return { nodes, links };
}

// Extiende los NodeProps/LinkProps reales de recharts en vez de tipar desde
// cero: el `payload` que recharts entrega en tiempo de ejecución sí trae el
// `color` que este componente agrega a cada nodo (Sankey.js copia con
// spread cualquier campo extra del nodo de entrada), pero el tipo `SankeyNode`
// que exporta la librería no lo declara -- `color` opcional aquí hace que
// un `SankeyNode` real siga siendo asignable a este tipo (estructuralmente
// compatible), a la vez que tipa lo que este componente de verdad usa.
interface PropsNodoPersonalizado extends Omit<SankeyNodeProps, "payload"> {
  payload: SankeyNodeProps["payload"] & { color?: string };
}

interface PropsEnlacePersonalizado extends Omit<SankeyLinkProps, "payload"> {
  payload: Omit<SankeyLinkProps["payload"], "source"> & {
    source: SankeyLinkProps["payload"]["source"] & { color?: string };
  };
}

function NodoPersonalizado(props: PropsNodoPersonalizado) {
  const { x, y, width, height, payload } = props;
  // Un nodo sin enlaces de salida es una hoja del diagrama (Ahorro, o una
  // categoría de gasto) -- su etiqueta va a la izquierda del nodo en vez de
  // a la derecha, para no quedar pegada al borde del contenedor.
  const esHoja = payload.sourceLinks.length === 0;
  const etiquetaX = esHoja ? x - 8 : x + width + 8;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={Math.max(height, 1)}
        fill={payload.color ?? COLOR_GASTO}
        fillOpacity={0.9}
      />
      <text
        x={etiquetaX}
        y={y + height / 2 - 7}
        textAnchor={esHoja ? "end" : "start"}
        fontSize={12}
        fill="var(--text-secondary)"
      >
        {payload.name}
      </text>
      <text
        x={etiquetaX}
        y={y + height / 2 + 8}
        textAnchor={esHoja ? "end" : "start"}
        fontSize={11}
        fill="var(--text-muted)"
      >
        {formateadorMoneda.format(Number(payload.value))}
      </text>
    </g>
  );
}

function EnlacePersonalizado(props: PropsEnlacePersonalizado) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = props;
  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={payload.source.color ?? COLOR_GASTO}
      strokeOpacity={0.25}
      strokeWidth={Math.max(linkWidth, 1)}
    />
  );
}

export function FlujoSankeyChart({ datos }: { datos: FlujoSankeyDatos }) {
  const { nodes, links } = construirDatosSankey(datos);
  const sinDatos = links.length === 0;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        Flujo de ingresos y gastos ({datos.meses[0]} a {datos.meses[datos.meses.length - 1]})
      </h3>
      {sinDatos ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          No hay ingresos ni gastos en los últimos 3 meses completos.
        </p>
      ) : (
        <div className="mt-3" style={{ height: 460 }}>
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={{ nodes, links }}
              nodeWidth={12}
              nodePadding={16}
              linkCurvature={0.5}
              margin={{ top: 20, right: 170, bottom: 20, left: 130 }}
              node={NodoPersonalizado}
              link={EnlacePersonalizado}
            >
              <Tooltip
                formatter={(value: unknown) => formateadorMoneda.format(Number(value))}
                contentStyle={{
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                }}
              />
            </Sankey>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
