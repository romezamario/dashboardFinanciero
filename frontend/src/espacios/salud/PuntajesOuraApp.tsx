// Puntajes que calculó la app de Oura (historial importado, hasta nov 2026).
// Lógica en puntajesOura.ts. Mario, 2026-11-19: "sí guarda los puntajes en el dashboard".
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmentado } from "../../components/Segmentado";
import { Caja, Leyenda, Vacio } from "./GraficasSalud";
import { EJE } from "./formatoSalud";
import {
  ESTRES_OURA,
  PUNTAJES,
  diasConPuntajesOura,
  estresPorMes,
  puntajesPorSemana,
  resumenOura,
  seriesSemanales,
  ultimosDeOura,
} from "./puntajesOura";
import type { DiaSalud } from "./salud";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesCorto = (f: string) => `${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(2, 4)}`;
const fechaLarga = (f: string) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`;
const conSigno = (v: number) => (v > 0 ? `+${v}` : `${v}`);

type Rango = "90" | "365" | "todo";
const RANGOS: { id: Rango; etiqueta: string }[] = [
  { id: "90", etiqueta: "3 meses" },
  { id: "365", etiqueta: "1 año" },
  { id: "todo", etiqueta: "Todo" },
];

function Cifra({ titulo, valor, pie }: { titulo: string; valor: string; pie?: string }) {
  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {titulo}
      </p>
      <p className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
        {valor}
      </p>
      {pie && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {pie}
        </p>
      )}
    </div>
  );
}

export function PuntajesOuraApp({ dias }: { dias: readonly DiaSalud[] }) {
  const [rango, setRango] = useState<Rango>("365");
  const conOura = useMemo(() => diasConPuntajesOura(dias), [dias]);
  const visibles = useMemo(() => ultimosDeOura(conOura, rango === "todo" ? null : Number(rango)), [conOura, rango]);
  const resumen = useMemo(() => resumenOura(visibles), [visibles]);
  const semanas = useMemo(() => puntajesPorSemana(visibles), [visibles]);
  const estres = useMemo(() => estresPorMes(visibles), [visibles]);
  const cardio = useMemo(() => seriesSemanales(visibles).filter((s) => s.vo2max !== null || s.edad !== null), [visibles]);

  if (!conOura.length || !resumen)
    return <Vacio>Todavía no hay puntajes de la app de Oura: aparecen cuando la laptop importe el historial.</Vacio>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmentado opciones={RANGOS} valor={rango} onCambiar={setRango} chico />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {fechaLarga(resumen.desde)} → {fechaLarga(resumen.hasta)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {PUNTAJES.map(({ clave, texto }) => (
          <Cifra key={clave} titulo={`${texto} (promedio)`} valor={resumen.promedios[clave] === null ? "—" : String(Math.round(resumen.promedios[clave]!))} />
        ))}
        <Cifra
          titulo="VO2 máx."
          valor={resumen.vo2max ? String(resumen.vo2max.ultimo.valor) : "—"}
          pie={resumen.vo2max?.cambio != null ? `${conSigno(resumen.vo2max.cambio)} en el periodo` : undefined}
        />
        <Cifra
          titulo="Edad cardiovascular"
          valor={resumen.edadCardiovascular ? `${resumen.edadCardiovascular.ultimo.valor} años` : "—"}
          pie={resumen.edadCardiovascular?.cambio != null ? `${conSigno(resumen.edadCardiovascular.cambio)} en el periodo` : undefined}
        />
      </div>

      <div>
        <p className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Puntajes por semana (promedio)
        </p>
        {semanas.length < 2 ? (
          <Vacio>Hacen falta 2 semanas o más con puntajes.</Vacio>
        ) : (
          <>
            <Leyenda items={PUNTAJES.map((p) => ({ color: p.color, texto: p.texto }))} />
            <div className="mt-2 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={semanas} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid vertical={false} stroke="var(--gridline)" />
                  <XAxis dataKey="semana" tickFormatter={mesCorto} tick={EJE} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis domain={[0, 100]} ticks={[0, 50, 70, 100]} tick={EJE} axisLine={false} tickLine={false} />
                  <ReferenceLine y={70} stroke="var(--text-muted)" strokeDasharray="3 3" />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const s = payload[0].payload as (typeof semanas)[number];
                      return (
                        <Caja
                          titulo={`Semana del ${fechaLarga(s.semana)}`}
                          lineas={PUNTAJES.map(({ clave, texto }) => (s[clave] === null ? null : `${texto}: ${Math.round(s[clave]!)}`))}
                        />
                      );
                    }}
                  />
                  {PUNTAJES.map((p) => (
                    <Line key={p.clave} dataKey={p.clave} name={p.texto} stroke={p.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {resumen.estres.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Estrés del día según Oura
          </p>
          <p className="mb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            {resumen.estres.map((e) => `${ESTRES_OURA[e.estado].texto}: ${e.pct}% (${e.dias} días)`).join(" · ")}
          </p>
          <Leyenda items={(["restored", "normal", "stressful"] as const).map((k) => ({ color: ESTRES_OURA[k].color, texto: ESTRES_OURA[k].texto }))} />
          <div className="mt-2 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={estres} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} stroke="var(--gridline)" />
                <XAxis dataKey="mes" tickFormatter={(m: string) => mesCorto(`${m}-01`)} tick={EJE} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={EJE} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "var(--gridline)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const m = payload[0].payload as (typeof estres)[number];
                    return (
                      <Caja
                        titulo={mesCorto(`${m.mes}-01`)}
                        lineas={(["restored", "normal", "stressful"] as const).map((k) => `${ESTRES_OURA[k].texto}: ${m[k]} días`)}
                      />
                    );
                  }}
                />
                {(["restored", "normal", "stressful"] as const).map((k) => (
                  <Bar key={k} dataKey={k} stackId="e" fill={ESTRES_OURA[k].color} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {cardio.length >= 2 && (
        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              { clave: "vo2max", titulo: "VO2 máx. (ml/kg/min)", color: "var(--series-1)", unidad: "" },
              { clave: "edad", titulo: "Edad cardiovascular (años)", color: "var(--series-2)", unidad: " años" },
            ] as const
          ).map((g) => (
            <div key={g.clave}>
              <p className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {g.titulo}
              </p>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cardio} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} stroke="var(--gridline)" />
                    <XAxis dataKey="semana" tickFormatter={mesCorto} tick={EJE} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={EJE} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const s = payload[0].payload as (typeof cardio)[number];
                        const v = s[g.clave];
                        return <Caja titulo={`Semana del ${fechaLarga(s.semana)}`} lineas={[v === null ? "Sin dato" : `${v}${g.unidad}`]} />;
                      }}
                    />
                    <Line dataKey={g.clave} stroke={g.color} strokeWidth={2} dot={false} connectNulls type="stepAfter" isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
