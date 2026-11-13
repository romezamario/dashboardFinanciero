// Dibujo de los indicadores nuevos de Salud (2026-11-13). Cálculos en
// indicadores.ts. Mismas piezas y colores por rol que GraficasSalud.tsx.
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Caja, Leyenda, Vacio } from "./GraficasSalud";
import { AMARILLO_AVISO, EJE, fechaCorta, horaDe, horasMin } from "./formatoSalud";
import {
  constanciaHorario,
  diasConTemperatura,
  estresDiurno,
  MINIMO_VENTANAS_BASE,
  UMBRAL_ESTRES,
  ventanasEnReposo,
  type DiaEstres,
  type EstadoVentana,
  horaFueraDeLoNormal,
  minutosPeriodo,
  periodosDelDia,
  puntajeSueno,
  recuperacion,
  temperaturaDelDia,
  type NivelConstancia,
  type NivelRecuperacion,
} from "./indicadores";
import { relojDesde18, type DiaSalud } from "./salud";

// --------------------------------------------- semáforo de recuperación

const SEMAFORO: Record<NivelRecuperacion, { texto: string; fondo: string; tinta: string; consejo: string }> = {
  listo: { texto: "Listo", fondo: "var(--status-good)", tinta: "#fff", consejo: "Tu cuerpo se recuperó: buen día para exigirte." },
  moderado: { texto: "Moderado", fondo: AMARILLO_AVISO, tinta: "#0b0b0b", consejo: "Recuperación a medias: ve con calma." },
  descansa: { texto: "Descansa", fondo: "var(--status-critical)", tinta: "#fff", consejo: "Señales de cansancio o de que algo se está incubando: prioriza dormir." },
};

const colorPuntos = (p: number) => (p >= 70 ? "var(--status-good)" : p >= 50 ? AMARILLO_AVISO : "var(--status-critical)");

export function TarjetaRecuperacion({ dias }: { dias: readonly DiaSalud[] }) {
  const r = useMemo(() => recuperacion(dias), [dias]);
  const ultima = dias.filter((d) => d.noche).at(-1);
  const sueno = puntajeSueno(ultima);
  if (!r)
    return (
      <Vacio>
        El semáforo compara tu noche con tu normal: aparece cuando hay al menos 3 noches anteriores con HRV, FC en reposo o
        temperatura.
      </Vacio>
    );
  const s = SEMAFORO[r.nivel];
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex items-center gap-3">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold tabular-nums"
          style={{ background: s.fondo, color: s.tinta }}
          aria-label={`Recuperación ${r.puntaje} de 100`}
        >
          {r.puntaje}
        </span>
        <div>
          <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {s.texto}
          </p>
          <p className="max-w-56 text-xs" style={{ color: "var(--text-secondary)" }}>
            {s.consejo}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            Noche que terminó el {fechaCorta(r.fecha)}
            {sueno !== null && ` · Puntaje de sueño ${Math.round(sueno)}`}
          </p>
        </div>
      </div>
      <ul className="min-w-56 flex-1 space-y-1.5">
        {r.factores.map((f) => (
          <li key={f.clave} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0" style={{ color: "var(--text-secondary)" }}>
              {f.nombre}
            </span>
            <span className="relative h-2 w-24 shrink-0 overflow-hidden rounded-full" style={{ background: "var(--page-plane)" }}>
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${f.puntos}%`, background: colorPuntos(f.puntos) }} />
            </span>
            <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
              {f.texto}
            </span>
          </li>
        ))}
      </ul>
      <p className="w-full text-xs" style={{ color: "var(--text-muted)" }}>
        Cálculo propio: cada señal contra tu promedio de los 30 días anteriores ({r.nochesBase} noches de base
        {r.nochesBase < 7 ? "; con pocas noches es todavía aproximado" : ""}) y lo que dormiste contra 8 h. No es el
        «Readiness» de Oura.
      </p>
    </div>
  );
}

// ------------------------------------------------ bloques de sueño del día

/** Todos los periodos de sueño que terminaron ese día, en una franja de 18:00
 * del día anterior a 18:00 del día (así la noche queda continua). */
export function BloquesSueno({ dia }: { dia: DiaSalud | undefined }) {
  const periodos = useMemo(() => periodosDelDia(dia), [dia]);
  if (!dia || !periodos.length) return <Vacio>No hay sueño registrado para este día.</Vacio>;
  // Inicio de la franja: 18:00 local del día anterior a `fecha`.
  const [a, m, d] = dia.fecha.split("-").map(Number);
  const desde = new Date(a, m - 1, d - 1, 18).getTime() / 1000;
  const total = 24 * 3600;
  const enFranja = (t: number) => Math.min(100, Math.max(0, ((t - desde) / total) * 100));
  const totalMin = periodos.reduce((s, p) => s + (minutosPeriodo(p) ?? 0), 0);
  const siestas = periodos.filter((p) => !p.principal);
  return (
    <div>
      <div className="relative h-8 rounded-md" style={{ background: "var(--page-plane)" }} role="img" aria-label="Bloques de sueño del día">
        {periodos.map((p) =>
          p.inicio == null || p.fin == null ? null : (
            <div
              key={p.inicio}
              className="absolute top-1 bottom-1 rounded"
              title={`${p.principal ? "Noche" : "Siesta / bloque"}: ${p.start ?? horaDe(p.inicio)}–${p.end ?? horaDe(p.fin)}`}
              style={{
                left: `${enFranja(p.inicio)}%`,
                width: `max(3px, ${enFranja(p.fin) - enFranja(p.inicio)}%)`,
                background: p.principal ? "var(--series-1)" : "var(--series-4)",
              }}
            />
          )
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px]" style={{ color: "var(--text-muted)" }}>
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{relojDesde18(h * 60)}</span>
        ))}
      </div>
      <div className="mt-2">
        <Leyenda items={[{ color: "var(--series-1)", texto: "Sueño principal" }, { color: "var(--series-4)", texto: "Siesta o bloque aparte" }]} />
      </div>
      <ul className="mt-2 space-y-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
        {periodos.map((p) => {
          const min = minutosPeriodo(p);
          return (
            <li key={`${p.inicio}`}>
              <strong style={{ color: "var(--text-primary)" }}>{p.principal ? "Noche" : "Siesta / bloque"}</strong>{" "}
              {p.start ?? (p.inicio != null ? horaDe(p.inicio) : "—")}–{p.end ?? (p.fin != null ? horaDe(p.fin) : "—")}
              {min != null && ` · ${horasMin(min)}`}
              {p.eficiencia != null && ` · eficiencia ${Math.round(p.eficiencia)}%`}
            </li>
          );
        })}
      </ul>
      {siestas.length > 0 && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          En total {horasMin(totalMin)} en {periodos.length} bloques. Las fases y el semáforo usan solo el sueño principal.
        </p>
      )}
    </div>
  );
}

// -------------------------------------------- constancia del horario

const CONSTANCIA: Record<NivelConstancia, { texto: string; color: string }> = {
  "muy-constante": { texto: "Muy constante", color: "var(--status-good)" },
  regular: { texto: "Regular", color: "var(--text-secondary)" },
  irregular: { texto: "Irregular", color: "var(--status-critical)" },
};

export function ConstanciaHorario({ dias }: { dias: readonly DiaSalud[] }) {
  const c = useMemo(() => constanciaHorario(dias), [dias]);
  if (!c)
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        La constancia de tu horario aparece con 3 noches o más.
      </p>
    );
  const nivel = CONSTANCIA[c.nivel];
  return (
    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
      Constancia: <strong style={{ color: nivel.color }}>{nivel.texto}</strong> · te duermes en promedio a las{" "}
      <strong style={{ color: "var(--text-primary)" }}>{relojDesde18(c.dormirPromedio)}</strong> (±{c.dormir} min) y despiertas a
      las <strong style={{ color: "var(--text-primary)" }}>{relojDesde18(c.despertarPromedio % 1440)}</strong> (±{c.despertar} min)
      · {c.noches} noches. Variar menos de 30 min ayuda a dormir mejor.
    </p>
  );
}

// --------------------------------------------- temperatura del día

export function TemperaturaDelDia({ dias }: { dias: readonly DiaSalud[] }) {
  const fechas = useMemo(() => diasConTemperatura(dias), [dias]);
  const [elegida, setElegida] = useState<string | null>(null);
  const fecha = elegida && fechas.includes(elegida) ? elegida : fechas[0];
  const puntos = useMemo(() => (fecha ? temperaturaDelDia(dias, fecha) : []), [dias, fecha]);
  if (!fecha) return <Vacio>Aún no hay temperatura por hora: aparecerá con la próxima lectura de la laptop.</Vacio>;
  const alta = horaFueraDeLoNormal(puntos);
  const conNormal = puntos.some((p) => p.normal !== null);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Día">
        {fechas.slice(0, 7).map((f) => (
          <button
            key={f}
            onClick={() => setElegida(f)}
            aria-pressed={f === fecha}
            className="rounded-full px-2.5 py-0.5 text-xs"
            style={{
              border: "1px solid var(--border)",
              background: f === fecha ? "var(--marca)" : "var(--surface-1)",
              color: f === fecha ? "#fff" : "var(--text-secondary)",
            }}
          >
            {fechaCorta(f)}
          </button>
        ))}
      </div>
      <div className="mt-2">
        <Leyenda
          items={[
            { color: "var(--series-2)", texto: `Día ${fechaCorta(fecha)}` },
            ...(conNormal ? [{ color: "var(--baseline)", texto: "Tu normal a esa hora" }] : []),
          ]}
        />
      </div>
      <div className="mt-2 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={puntos} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="hora" tickFormatter={(h) => `${h}h`} tick={EJE} axisLine={false} tickLine={false} interval={2} />
            <YAxis domain={["auto", "auto"]} tick={EJE} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(1)}°`} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof puntos)[number];
                return (
                  <Caja
                    titulo={`${p.hora}:00`}
                    lineas={[
                      p.valor === null ? "Sin dato (anillo sin poner o apagado)" : `${p.valor.toFixed(1)} °C`,
                      p.normal === null ? null : `Tu normal: ${p.normal.toFixed(1)} °C`,
                    ]}
                  />
                );
              }}
            />
            {conNormal && <Line dataKey="normal" stroke="var(--baseline)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
            <Line dataKey="valor" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 2.5, fill: "var(--series-2)", stroke: "var(--surface-1)", strokeWidth: 1.5 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs" style={{ color: alta ? "var(--status-critical)" : "var(--text-muted)" }}>
        {alta
          ? `⚠ A las ${alta.hora}:00 estuviste ${((alta.valor as number) - (alta.normal as number)).toFixed(1)} °C arriba de tu normal para esa hora. Si te sientes mal, puede ser fiebre.`
          : "La piel se enfría de día y se calienta al dormir; la línea punteada es tu promedio a cada hora en los otros días."}
      </p>
    </div>
  );
}

// --------------------------------------------------- estrés diurno

const ESTADOS: Record<EstadoVentana, { texto: string; color: string }> = {
  estres: { texto: "Estrés", color: "var(--series-2)" },
  recuperacion: { texto: "Recuperación", color: "var(--series-1)" },
  normal: { texto: "Normal", color: "var(--text-muted)" },
  movimiento: { texto: "En movimiento", color: "var(--gridline)" },
};
const TOPE_PUNTAJE = 3;
const horaLocal = (unix: number) => {
  const d = new Date(unix * 1000);
  return d.getHours() + d.getMinutes() / 60;
};
const duracion = (min: number) => (min < 60 ? `${min} min` : horasMin(min));

function BarraDia({ dia }: { dia: DiaEstres }) {
  const reposo = dia.minutos.estres + dia.minutos.normal + dia.minutos.recuperacion;
  if (!reposo) return null;
  const tramos: EstadoVentana[] = ["estres", "normal", "recuperacion"];
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--gridline)" }} aria-hidden>
      {tramos.map((e) => (
        <span key={e} style={{ width: `${(dia.minutos[e] / reposo) * 100}%`, background: ESTADOS[e].color }} />
      ))}
    </div>
  );
}

export function EstresDelDia({ dias }: { dias: readonly DiaSalud[] }) {
  const porDia = useMemo(() => estresDiurno(dias).reverse(), [dias]);
  const [elegida, setElegida] = useState<string | null>(null);
  const reposo = useMemo(() => (porDia.length ? 0 : ventanasEnReposo(dias)), [dias, porDia]);
  if (!porDia.length) {
    return (
      <Vacio>
        {reposo
          ? `Juntando tu normal de día: ${reposo} de ${MINIMO_VENTANAS_BASE} ratos de 15 min en reposo con el anillo puesto.`
          : "Aún no hay datos de estrés: aparecerán con la próxima lectura de la laptop."}
      </Vacio>
    );
  }
  const dia = porDia.find((d) => d.fecha === elegida) ?? porDia[0];
  const puntos = dia.puntos
    .filter((p) => p.puntaje !== null)
    .map((p) => ({ ...p, hora: horaLocal(p.inicio), valor: Math.max(-TOPE_PUNTAJE, Math.min(TOPE_PUNTAJE, p.puntaje as number)) }));
  const m = dia.minutos;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Día">
        {porDia.slice(0, 7).map((d) => (
          <button
            key={d.fecha}
            onClick={() => setElegida(d.fecha)}
            aria-pressed={d.fecha === dia.fecha}
            className="rounded-full px-2.5 py-0.5 text-xs"
            style={{
              border: "1px solid var(--border)",
              background: d.fecha === dia.fecha ? "var(--marca)" : "var(--surface-1)",
              color: d.fecha === dia.fecha ? "#fff" : "var(--text-secondary)",
            }}
          >
            {fechaCorta(d.fecha)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        <strong style={{ color: ESTADOS.estres.color }}>{duracion(m.estres)} de estrés</strong> ·{" "}
        <strong style={{ color: ESTADOS.recuperacion.color }}>{duracion(m.recuperacion)} de recuperación</strong> · {duracion(m.normal)} normal
        {m.movimiento ? ` · ${duracion(m.movimiento)} en movimiento (no se juzga)` : ""}
      </p>
      <div className="mt-2">
        <Leyenda items={(["estres", "normal", "recuperacion"] as const).map((e) => ({ color: ESTADOS[e].color, texto: ESTADOS[e].texto }))} />
      </div>
      <div className="mt-2 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={puntos} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis
              type="number"
              dataKey="hora"
              domain={[0, 24]}
              ticks={[0, 3, 6, 9, 12, 15, 18, 21, 24]}
              tickFormatter={(h: number) => `${h}h`}
              tick={EJE}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[-TOPE_PUNTAJE, TOPE_PUNTAJE]}
              ticks={[-2, 0, 2]}
              tickFormatter={(v: number) => (v > 0 ? "estrés" : v < 0 ? "calma" : "normal")}
              tick={EJE}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <ReferenceLine y={0} stroke="var(--baseline)" />
            <ReferenceLine y={UMBRAL_ESTRES} stroke="var(--baseline)" strokeDasharray="3 3" />
            <ReferenceLine y={-UMBRAL_ESTRES} stroke="var(--baseline)" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof puntos)[number];
                return (
                  <Caja
                    titulo={`${horaDe(p.inicio)} · ${ESTADOS[p.estado].texto}`}
                    lineas={[
                      `FC ${Math.round(p.lpm)} lpm (tu normal ${dia.normal.lpm})`,
                      `HRV ${Math.round(p.rmssd)} ms (tu normal ${dia.normal.rmssd})`,
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="valor" barSize={5} isAnimationActive={false}>
              {puntos.map((p) => (
                <Cell key={p.inicio} fill={ESTADOS[p.estado].color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {porDia.length > 1 && (
        <ul className="mt-3 space-y-1.5">
          {porDia.slice(0, 7).map((d) => (
            <li key={d.fecha} className="grid grid-cols-[3rem_1fr] items-center gap-2 text-xs sm:grid-cols-[3rem_1fr_17rem]" style={{ color: "var(--text-secondary)" }}>
              <span>{fechaCorta(d.fecha)}</span>
              <BarraDia dia={d} />
              <span className="col-start-2 sm:col-start-auto">
                {duracion(d.minutos.estres)} estrés · {duracion(d.minutos.recuperacion)} recuperación
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Cálculo propio, no el estrés de Oura: cada 15 min en reposo se compara tu FC y tu HRV de día con tu normal (mediana de 14 días:{" "}
        {dia.normal.lpm} lpm, {dia.normal.rmssd} ms). FC arriba con HRV abajo = estrés; al revés = recuperación. Al caminar o hacer
        ejercicio no se juzga, y solo cuenta el tiempo con buena lectura del anillo.
      </p>
    </div>
  );
}
