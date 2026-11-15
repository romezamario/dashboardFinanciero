// Sesiones de ejercicio en la pestaña Actividad (Mario, 2026-11-15). Cálculos
// en ejercicio.ts; los datos los arma el colector de la laptop.
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DiaSalud } from "./salud";
import { Caja, Leyenda, Vacio } from "./GraficasSalud";
import { EJE, fechaCorta, horasMin } from "./formatoSalud";
import { META_SEMANAL_MIN, horaEnZona, minutosPorDia, resumenEjercicio, sesionesRecientes, type MinutosDia, type SesionConFecha } from "./ejercicio";

const COLOR_MODERADO = "var(--series-1)";
const COLOR_VIGOROSO = "var(--series-2)";
const VISIBLES = 8;
const duracion = (min: number) => (min < 60 ? `${min} min` : horasMin(min));
const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const diaSemana = (fecha: string) => DIAS_SEMANA[new Date(`${fecha}T12:00:00Z`).getUTCDay()];

function Dato({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-md px-3 py-2" style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {etiqueta}
      </p>
      <p className="text-lg font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
        {valor}
      </p>
      {detalle && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {detalle}
        </p>
      )}
    </div>
  );
}

function FilaSesion({ s }: { s: SesionConFecha }) {
  const vigorosa = s.intensidad === "vigorosa";
  const inicio = s.hora ?? horaEnZona(s.inicio, s.utc_offset_min);
  const fin = horaEnZona(s.fin, s.utc_offset_min);
  const detalles = [
    `MET ${s.met_prom.toLocaleString("es-MX", { maximumFractionDigits: 1 })}`,
    typeof s.lpm_mediana === "number" ? `FC ${s.lpm_mediana} lpm${typeof s.lpm_max === "number" ? ` (pico ${s.lpm_max})` : ""}` : "sin FC",
    typeof s.kcal === "number" ? `${s.kcal} kcal` : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm" style={{ borderTop: "1px solid var(--border)" }}>
      <span className="w-24 shrink-0 tabular-nums" style={{ color: "var(--text-secondary)" }}>
        {diaSemana(s.fecha)} {fechaCorta(s.fecha)}
      </span>
      <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
        {inicio}–{fin} · {duracion(s.duracion_min)}
      </span>
      <span
        className="rounded-full px-2 py-0.5 text-xs"
        style={{ border: `1px solid ${vigorosa ? COLOR_VIGOROSO : COLOR_MODERADO}`, color: "var(--text-primary)" }}
      >
        <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: vigorosa ? COLOR_VIGOROSO : COLOR_MODERADO }} aria-hidden />
        {vigorosa ? "Vigorosa" : "Moderada"}
      </span>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {detalles.join(" · ")}
      </span>
    </li>
  );
}

export function EjercicioSalud({ dias }: { dias: readonly DiaSalud[] }) {
  const resumen = useMemo(() => resumenEjercicio(dias), [dias]);
  const porDia = useMemo(() => minutosPorDia(dias), [dias]);
  const sesiones = useMemo(() => sesionesRecientes(dias), [dias]);
  const [todas, setTodas] = useState(false);
  const algunoConDatos = dias.some((d) => d.ejercicio !== undefined);
  if (!resumen || !sesiones.length) {
    return (
      <Vacio>
        {algunoConDatos || dias.some((d) => d.estresVentanas?.length)
          ? "No se detectó ejercicio en este periodo (10 min o más seguidos de actividad moderada o vigorosa)."
          : "Aún no hay sesiones de ejercicio: aparecerán cuando la laptop se actualice y haga su próxima lectura."}
      </Vacio>
    );
  }
  const pct = Math.round((resumen.equivalentesPorSemana / META_SEMANAL_MIN) * 100);
  const visibles = todas ? sesiones : sesiones.slice(0, VISIBLES);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Dato etiqueta="Sesiones" valor={String(resumen.sesiones)} />
        <Dato etiqueta="Tiempo total" valor={duracion(resumen.minutos)} />
        <Dato
          etiqueta="Por semana vs. meta OMS"
          valor={`${resumen.equivalentesPorSemana} de ${META_SEMANAL_MIN} min`}
          detalle={pct >= 100 ? `✓ ${pct}% de la meta` : `${pct}% de la meta`}
        />
        <Dato etiqueta="Calorías activas" valor={resumen.kcal === null ? "—" : `${resumen.kcal.toLocaleString("es-MX")} kcal`} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Minutos de ejercicio por día
        </p>
        <Leyenda
          items={[
            { color: COLOR_MODERADO, texto: "Moderado (3–6 MET)" },
            { color: COLOR_VIGOROSO, texto: "Vigoroso (6+ MET)" },
          ]}
        />
      </div>
      <div className="mt-1 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={porDia} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="fecha" tickFormatter={fechaCorta} tick={EJE} axisLine={false} tickLine={false} />
            <YAxis tick={EJE} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as MinutosDia;
                return (
                  <Caja
                    titulo={`${diaSemana(d.fecha)} ${fechaCorta(d.fecha)}`}
                    lineas={d.moderados + d.vigorosos ? [`Moderado: ${d.moderados} min`, `Vigoroso: ${d.vigorosos} min`] : ["Sin ejercicio"]}
                  />
                );
              }}
            />
            <Bar dataKey="moderados" stackId="m" fill={COLOR_MODERADO} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="vigorosos" stackId="m" fill={COLOR_VIGOROSO} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3">
        {visibles.map((s) => (
          <FilaSesion key={s.inicio} s={s} />
        ))}
      </ul>
      {sesiones.length > VISIBLES && (
        <button className="mt-2 text-xs underline" style={{ color: "var(--marca)" }} onClick={() => setTodas(!todas)}>
          {todas ? "Ver menos" : `Ver las ${sesiones.length} sesiones`}
        </button>
      )}
    </div>
  );
}
