import { useEffect, useMemo, useState } from "react";
import {
  calcularLecturasMacro,
  GRUPOS,
  obtenerDatosMacro,
  type DatosMacro,
  type LecturaMacro,
  type Observacion,
} from "../lib/macro";

const estiloTarjeta = { background: "var(--surface-1)", border: "1px solid var(--border)" };

/** Indicadores macro de EE.UU. que sigue la Fed (y que mueven al Nasdaq-100),
 * agrupados como recuadros con su último dato, el cambio vs. el anterior y una
 * minigráfica de ~2 años. Datos de FRED vía /macro.json (generado en el deploy). */
export function MacroEeuu() {
  const [datos, setDatos] = useState<DatosMacro | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    obtenerDatosMacro()
      .then(setDatos)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const lecturas = useMemo(() => (datos ? calcularLecturasMacro(datos) : []), [datos]);
  const fallidas = datos ? Object.keys(datos.errores) : [];

  if (!datos) {
    return (
      <p
        className="text-sm"
        style={{ color: error ? "var(--status-critical)" : "var(--text-secondary)" }}
      >
        {error ? `No se pudieron traer los indicadores: ${error}` : "Cargando indicadores…"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Fuente: FRED (Fed de St. Louis) · descargado el{" "}
        {new Date(datos.actualizado).toLocaleString("es-MX", {
          dateStyle: "medium",
          timeStyle: "short",
        })}{" "}
        · se actualiza solo dos veces al día, de lunes a viernes
      </p>
      {fallidas.length > 0 && (
        <p className="text-xs" style={{ color: "var(--status-critical)" }}>
          No se pudieron descargar: {fallidas.join(", ")}.
        </p>
      )}

      {GRUPOS.map((grupo) => {
        const delGrupo = lecturas.filter((l) => l.grupo === grupo);
        if (delGrupo.length === 0) return null;
        return (
          <section key={grupo} className="space-y-3">
            <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {grupo}
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {delGrupo.map((l) => (
                <TileMacro key={l.id} lectura={l} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Cada dato corresponde al periodo indicado (no a su fecha de publicación) y FRED lo
        actualiza horas después de que sale el reporte oficial. Las series diarias se comparan
        contra el cierre del mes anterior. Verde/rojo = si el cambio suele ser buena o mala noticia
        para el Nasdaq-100: menos inflación, tasas y volatilidad, y más crecimiento y empleo, en
        verde (un dato de empleo muy fuerte puede leerse al revés si aleja los recortes de la Fed).
        La curva 10a−2a va sin color. Pasa el mouse sobre la minigráfica para ver cada valor.
      </p>
    </div>
  );
}

function TileMacro({ lectura }: { lectura: LecturaMacro }) {
  return (
    <div className="flex flex-col rounded-lg p-4" style={estiloTarjeta} title={lectura.descripcion}>
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {lectura.titulo}
      </div>
      <div
        className="mt-1 text-xl font-semibold"
        style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
      >
        {lectura.valor}
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {lectura.periodo}
      </div>
      {lectura.cambio && (
        <div
          className="mt-1 text-xs"
          style={{
            color:
              lectura.tono === "favorable"
                ? "var(--status-good)"
                : lectura.tono === "desfavorable"
                  ? "var(--status-critical)"
                  : "var(--text-secondary)",
          }}
        >
          {lectura.cambio}
        </div>
      )}
      {lectura.detalle && (
        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {lectura.detalle}
        </div>
      )}
      <div className="mt-auto pt-3">
        <MiniTendencia
          historia={lectura.historia}
          referencia={lectura.referencia}
          formato={lectura.formatoHistoria}
          etiqueta={lectura.titulo}
        />
      </div>
    </div>
  );
}

const ANCHO = 160;
const ALTO = 36;
const MARGEN = 3;

/** Minigráfica escalada al mínimo/máximo de la propia serie (tasas e
 * inflación se mueven en rangos chicos; desde 0 se verían planas). La línea
 * punteada es la referencia (meta de 2%, cero) cuando cae dentro del rango. */
function MiniTendencia({
  historia,
  referencia,
  formato,
  etiqueta,
}: {
  historia: Observacion[];
  referencia?: number;
  formato: (v: number) => string;
  etiqueta: string;
}) {
  if (historia.length < 2) return null;
  const valores = historia.map((o) => o.valor);
  const minimo = Math.min(...valores, referencia ?? Infinity);
  const maximo = Math.max(...valores, referencia ?? -Infinity);
  const rango = maximo - minimo || 1;
  const paso = (ANCHO - MARGEN * 2) / (historia.length - 1);
  const aY = (v: number) => ALTO - MARGEN - ((v - minimo) / rango) * (ALTO - MARGEN * 2);
  const puntos = historia.map((o, i) => ({ x: MARGEN + i * paso, y: aY(o.valor) }));
  const ultimo = puntos[puntos.length - 1];
  return (
    <svg
      viewBox={`0 0 ${ANCHO} ${ALTO}`}
      className="block h-9 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Tendencia de ${etiqueta}: de ${formato(valores[0])} a ${formato(
        valores[valores.length - 1]
      )}`}
      style={{ overflow: "visible" }}
    >
      {referencia != null && (
        <line
          x1={0}
          x2={ANCHO}
          y1={aY(referencia)}
          y2={aY(referencia)}
          stroke="var(--baseline)"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        points={puntos.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={ultimo.x} cy={ultimo.y} r={2.5} fill="var(--series-1)" />
      {/* Zonas invisibles por punto, más anchas que el trazo, para el tooltip. */}
      {historia.map((o, i) => (
        <rect key={o.fecha} x={puntos[i].x - paso / 2} y={0} width={paso} height={ALTO} fill="transparent">
          <title>{`${o.fecha}: ${formato(o.valor)}`}</title>
        </rect>
      ))}
    </svg>
  );
}
