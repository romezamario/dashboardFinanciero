// Tus puntuaciones de 0 a 100 (sueño, recuperación, actividad), 2026-11-19.
// Cálculo en puntuaciones.ts y en indicadores.ts (recuperación).
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Caja, Leyenda, Vacio } from "./GraficasSalud";
import { AMARILLO_AVISO, EJE, fechaCorta } from "./formatoSalud";
import { FORMULA_RECUPERACION, nocheSinSenales, recuperacion } from "./indicadores";
import {
  FORMULA_ACTIVIDAD,
  FORMULA_SUENO,
  historialPuntuaciones,
  nivelDe,
  puntuacionActividad,
  puntuacionSueno,
  type Componente,
} from "./puntuaciones";
import { restarDias, type DiaSalud } from "./salud";

const colorPuntos = (p: number) => (p >= 70 ? "var(--status-good)" : p >= 50 ? AMARILLO_AVISO : "var(--status-critical)");
const tintaPuntos = (p: number) => (p >= 70 || p < 50 ? "#fff" : "#0b0b0b");

const TEXTO_NIVEL = { bien: "Bien", regular: "Regular", bajo: "Bajo" } as const;
const TEXTO_RECUPERACION = { listo: "Listo", moderado: "Moderado", descansa: "Descansa" } as const;

function Tarjeta({
  titulo,
  puntaje,
  nivel,
  pie,
  componentes,
}: {
  titulo: string;
  puntaje: number;
  nivel: string;
  pie: string;
  componentes: readonly Componente[];
}) {
  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold tabular-nums"
          style={{ background: colorPuntos(puntaje), color: tintaPuntos(puntaje) }}
          aria-label={`${titulo} ${puntaje} de 100`}
        >
          {puntaje}
        </span>
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {titulo} · {nivel}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {pie}
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {componentes.map((c) => (
          <li key={c.clave} className="text-xs">
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0" style={{ color: "var(--text-secondary)" }}>
                {c.nombre}
              </span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--page-plane)" }}>
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${c.puntos}%`, background: colorPuntos(c.puntos) }} />
              </span>
              <span className="w-7 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                {c.puntos}
              </span>
            </div>
            <div style={{ color: "var(--text-muted)", paddingLeft: "7.5rem" }}>
              {c.texto}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Formula({ titulo, filas }: { titulo: string; filas: readonly { nombre: string; peso: number; regla: string }[] }) {
  return (
    <div>
      <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
        {titulo}
      </p>
      <table className="mt-1 w-full text-xs">
        <tbody>
          {filas.map((f) => (
            <tr key={f.nombre} style={{ borderTop: "1px solid var(--border)" }}>
              <td className="py-1 pr-2 align-top whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                {f.nombre}
              </td>
              <td className="py-1 pr-2 align-top whitespace-nowrap tabular-nums" style={{ color: "var(--text-primary)" }}>
                {f.peso} %
              </td>
              <td className="py-1 align-top" style={{ color: "var(--text-muted)" }}>
                {f.regla}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Las tres puntuaciones del día más reciente, con sus componentes y la fórmula. */
export function PuntuacionesHoy({ dias, hoy }: { dias: readonly DiaSalud[]; hoy: string }) {
  const sueno = useMemo(() => puntuacionSueno(dias), [dias]);
  const recup = useMemo(() => recuperacion(dias), [dias]);
  const actividad = useMemo(() => puntuacionActividad(dias), [dias]);
  const ultima = dias.filter((d) => d.noche).at(-1);

  return (
    <div>
      <div className="grid gap-3 lg:grid-cols-3">
        {sueno ? (
          <Tarjeta titulo="Sueño" puntaje={sueno.puntaje} nivel={TEXTO_NIVEL[sueno.nivel]} pie={`Noche que terminó el ${fechaCorta(sueno.fecha)}`} componentes={sueno.componentes} />
        ) : (
          <Vacio>Sin noche con duración medida todavía.</Vacio>
        )}
        {recup ? (
          <Tarjeta
            titulo="Recuperación"
            puntaje={recup.puntaje}
            nivel={TEXTO_RECUPERACION[recup.nivel]}
            pie={`${fechaCorta(recup.fecha)} · ${recup.nochesBase} noches de base${recup.nochesBase < 7 ? " (aún aproximado)" : ""}`}
            componentes={recup.factores}
          />
        ) : (
          <Vacio>
            {nocheSinSenales(ultima)
              ? `Tu última noche (${fechaCorta(ultima!.fecha)}) no trae HRV, FC en reposo ni temperatura: no hay con qué comparar.`
              : "Aparece cuando hay al menos 3 noches anteriores con HRV, FC en reposo o temperatura."}
          </Vacio>
        )}
        {actividad ? (
          <Tarjeta
            titulo="Actividad"
            puntaje={actividad.puntaje}
            nivel={TEXTO_NIVEL[actividad.nivel]}
            pie={actividad.fecha === hoy ? "Hoy, hasta ahora (sube conforme te mueves)" : `Día ${fechaCorta(actividad.fecha)}`}
            componentes={actividad.componentes}
          />
        ) : (
          <Vacio>Sin pasos ni ejercicio registrados todavía.</Vacio>
        )}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--marca)" }}>
          ¿Cómo se calculan?
        </summary>
        <div className="mt-2 space-y-3">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Cálculo propio con los datos del anillo y tus líneas base; no son las puntuaciones de Oura. Cada componente vale de 0 a 100 y
            la puntuación es su promedio ponderado (el % es el peso). Si a una noche o a un día le falta un dato, ese componente no
            cuenta y los demás se reparten su peso. 70 o más = bien (verde), 50–69 = regular (amarillo), menos de 50 = bajo (rojo).
          </p>
          <Formula titulo="Sueño" filas={FORMULA_SUENO} />
          <Formula titulo="Recuperación (necesita al menos HRV, FC en reposo o temperatura con 3 noches de base)" filas={FORMULA_RECUPERACION} />
          <Formula titulo="Actividad (el día en curso va subiendo)" filas={FORMULA_ACTIVIDAD} />
        </div>
      </details>
    </div>
  );
}

const SERIES = [
  { clave: "sueno", texto: "Sueño", color: "var(--series-1)" },
  { clave: "recuperacion", texto: "Recuperación", color: "var(--series-2)" },
  { clave: "actividad", texto: "Actividad", color: "var(--series-3)" },
] as const;

/** Las tres puntuaciones de los últimos 30 días. */
export function HistorialPuntuaciones({ dias }: { dias: readonly DiaSalud[] }) {
  const datos = useMemo(() => {
    const ultimo = dias.at(-1)?.fecha;
    if (!ultimo) return [];
    const desde = restarDias(ultimo, 29);
    const fechas = dias.filter((d) => d.fecha >= desde).map((d) => d.fecha);
    return historialPuntuaciones(dias, fechas, (f) => recuperacion(dias, f)?.puntaje ?? null);
  }, [dias]);
  if (datos.filter((p) => p.sueno !== null || p.recuperacion !== null || p.actividad !== null).length < 2)
    return <Vacio>La tendencia aparece con 2 días o más con puntuación.</Vacio>;
  return (
    <div>
      <Leyenda items={SERIES.map((s) => ({ color: s.color, texto: s.texto }))} />
      <div className="mt-2 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="fecha" tickFormatter={fechaCorta} tick={EJE} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} ticks={[0, 50, 70, 100]} tick={EJE} axisLine={false} tickLine={false} />
            <ReferenceLine y={70} stroke="var(--text-muted)" strokeDasharray="3 3" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof datos)[number];
                return (
                  <Caja
                    titulo={fechaCorta(p.fecha)}
                    lineas={SERIES.map((s) => {
                      const v = p[s.clave];
                      return `${s.texto}: ${v === null ? "sin dato" : `${v} (${TEXTO_NIVEL[nivelDe(v)].toLowerCase()})`}`;
                    })}
                  />
                );
              }}
            />
            {SERIES.map((s) => (
              <Line
                key={s.clave}
                dataKey={s.clave}
                name={s.texto}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 3, fill: s.color, stroke: "var(--surface-1)", strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Línea punteada: 70, desde donde una puntuación está «bien».
      </p>
    </div>
  );
}
