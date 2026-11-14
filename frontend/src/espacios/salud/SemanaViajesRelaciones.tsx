// Dibujo del aviso del colector, el resumen semanal, las relaciones entre
// datos y la vista de viaje (Mario, 2026-11-14). Cálculos en colector.ts,
// semanal.ts, relaciones.ts y viajes.ts (probados en semanal.test.ts).
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Caja, Leyenda, Vacio } from "./GraficasSalud";
import { AMARILLO_AVISO, EJE, fechaCorta, horasMin } from "./formatoSalud";
import { avisoColector, textoZona, type EstadoColector } from "./colector";
import type { DiaEstres } from "./indicadores";
import { fraseRelacion, MINIMO_PARES, paresDe, relacion, RELACIONES, type DefRelacion } from "./relaciones";
import { minutosDormido, num, relojDesde18, restarDias, type DiaSalud } from "./salud";
import { resumenSemanal, semanaParaResumir, semanasConDatos, type CambioSemana } from "./semanal";
import {
  DIAS_ANTES_VIAJE,
  DIAS_REGRESO,
  borrarViaje,
  efectoViaje,
  guardarViaje,
  problemaViaje,
  tramosFueraDeCasa,
  tramosSinMarcar,
  veredicto,
  type ClaveEfecto,
  type FilaEfecto,
  type TramoFuera,
  type ValorTramo,
  type Veredicto,
  type Viaje,
} from "./viajes";

const fechaLarga = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

// ------------------------------------------------------ aviso colector

export function AvisoColector({ estado }: { estado: EstadoColector | null }) {
  const aviso = avisoColector(estado);
  if (!aviso) return null;
  return (
    <section role="alert" className="rounded-lg p-4 text-sm" style={{ border: `1px solid ${AMARILLO_AVISO}`, background: "var(--surface-1)" }}>
      <p className="font-medium" style={{ color: "var(--text-primary)" }}>
        <span aria-hidden>⚠ </span>
        {aviso.titulo}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        {aviso.detalle}
      </p>
    </section>
  );
}

// ---------------------------------------------------- valores y veredictos

function formato(clave: ClaveEfecto, v: number | null): string {
  if (v === null) return "—";
  if (clave === "sueno") return horasMin(v);
  if (clave === "dormir") return relojDesde18(Math.round(v) % 1440);
  if (clave === "estres") return `${Math.round(v)}%`;
  return `${Math.round(v)}`;
}

function diferencia(clave: ClaveEfecto, antes: number | null, ahora: number | null): string | null {
  if (antes === null || ahora === null) return null;
  const d = ahora - antes;
  if (clave === "dormir") {
    const m = Math.round(Math.abs(d));
    const texto = m < 60 ? `${m} min` : horasMin(m).replace(" 00 min", "");
    return m < 5 ? "a la misma hora" : `${texto} ${d > 0 ? "más tarde" : "más temprano"}`;
  }
  const signo = d > 0 ? "+" : d < 0 ? "−" : "±";
  if (clave === "sueno") return `${signo}${Math.round(Math.abs(d))} min`;
  if (clave === "estres") return `${signo}${Math.round(Math.abs(d))} pts`;
  return `${signo}${Math.round(Math.abs(d))}`;
}

const VEREDICTO: Record<Veredicto, { texto: string; icono: string; color: string }> = {
  mejor: { texto: "Mejoró", icono: "▲", color: "var(--status-good)" },
  peor: { texto: "Empeoró", icono: "▼", color: "var(--status-critical)" },
  igual: { texto: "Igual", icono: "=", color: "var(--text-secondary)" },
  "sin-dato": { texto: "Sin comparar", icono: "·", color: "var(--text-muted)" },
};

function Etiqueta({ v }: { v: Veredicto }) {
  const e = VEREDICTO[v];
  return (
    <span className="whitespace-nowrap text-xs font-medium" style={{ color: e.color }}>
      <span aria-hidden>{e.icono} </span>
      {e.texto}
    </span>
  );
}

// ----------------------------------------------------- resumen semanal

export function ResumenSemanal({ dias, estres, hoy }: { dias: readonly DiaSalud[]; estres: readonly DiaEstres[]; hoy: string }) {
  const semanas = useMemo(() => semanasConDatos(dias), [dias]);
  const porDefecto = semanaParaResumir(hoy);
  const [lunes, setLunes] = useState(() => (semanas.includes(porDefecto) ? porDefecto : (semanas.filter((s) => s <= porDefecto).at(-1) ?? semanas.at(-1) ?? porDefecto)));
  const r = useMemo(() => resumenSemanal(dias, estres, lunes), [dias, estres, lunes]);
  const i = semanas.indexOf(lunes);
  const esDomingo = new Date(`${hoy}T00:00:00Z`).getUTCDay() === 0;
  const enCurso = r.domingo >= hoy;
  const mejoro = r.cambios.filter((c) => c.veredicto === "mejor");
  const empeoro = r.cambios.filter((c) => c.veredicto === "peor");
  const boton = "rounded-full px-3 py-1 text-xs font-medium disabled:opacity-40";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={boton} style={{ border: "1px solid var(--border)", color: "var(--marca)" }} disabled={i <= 0} onClick={() => setLunes(semanas[i - 1])} aria-label="Semana anterior">
          ‹
        </button>
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Semana del {fechaCorta(r.lunes)} al {fechaCorta(r.domingo)}
          {enCurso && (esDomingo && r.domingo === hoy ? " · cierra hoy" : " · en curso")}
        </span>
        <button
          className={boton}
          style={{ border: "1px solid var(--border)", color: "var(--marca)" }}
          disabled={i < 0 || i >= semanas.length - 1}
          onClick={() => setLunes(semanas[i + 1])}
          aria-label="Semana siguiente"
        >
          ›
        </button>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {r.noches} noche{r.noches === 1 ? "" : "s"} con datos · contra la semana del {fechaCorta(restarDias(r.lunes, 7))}
        </span>
      </div>

      {mejoro.length + empeoro.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ListaCambios titulo="Lo que mejoró" cambios={mejoro} vacio="Nada mejoró de forma clara." />
          <ListaCambios titulo="Lo que empeoró" cambios={empeoro} vacio="Nada empeoró de forma clara." />
        </div>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {r.cambios.some((c) => c.veredicto === "igual")
            ? "Una semana pareja: nada cambió lo suficiente contra la anterior."
            : "Todavía no hay dos semanas con al menos 3 días de datos para comparar."}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-xs" style={{ color: "var(--text-secondary)" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-1 text-left font-medium">Indicador</th>
              <th className="py-1 text-right font-medium">Esta semana</th>
              <th className="py-1 text-right font-medium">Anterior</th>
              <th className="py-1 text-right font-medium">Cambio</th>
              <th className="py-1 pl-3 text-left font-medium">Veredicto</th>
            </tr>
          </thead>
          <tbody>
            {(["Sueño", "Recuperación", "Estrés"] as const).flatMap((g) =>
              r.cambios
                .filter((c) => c.grupo === g)
                .map((c, k) => (
                  <tr key={c.clave} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="py-1.5">
                      {k === 0 && <span className="mr-1 font-medium" style={{ color: "var(--text-primary)" }}>{g} ·</span>}
                      {c.nombre}
                    </td>
                    <td className="py-1.5 text-right" style={{ color: "var(--text-primary)" }}>
                      {formato(c.clave, c.actual.valor)}
                      <span style={{ color: "var(--text-muted)" }}> ({c.actual.n} d)</span>
                    </td>
                    <td className="py-1.5 text-right">{formato(c.clave, c.anterior.valor)}</td>
                    <td className="py-1.5 text-right">{diferencia(c.clave, c.anterior.valor, c.actual.valor) ?? "—"}</td>
                    <td className="py-1.5 pl-3">
                      <Etiqueta v={c.veredicto} />
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Promedios por día de lunes a domingo; una métrica se compara con al menos 3 días en cada semana. "Igual" = cambió menos de
        15 min de sueño, 3 ms de HRV, 2 lpm, 5 puntos de recuperación o 5 puntos de % de estrés. La hora de dormir no se califica, solo se
        muestra cuánto se movió.
      </p>
    </div>
  );
}

function ListaCambios({ titulo, cambios, vacio }: { titulo: string; cambios: CambioSemana[]; vacio: string }) {
  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
      <h4 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {titulo}
      </h4>
      {cambios.length ? (
        <ul className="mt-2 space-y-1 text-sm" style={{ color: "var(--text-primary)" }}>
          {cambios.map((c) => (
            <li key={c.clave}>
              <Etiqueta v={c.veredicto} /> {c.nombre.replace(/ \(.*\)$/, "")}: {formato(c.clave, c.anterior.valor)} → {formato(c.clave, c.actual.valor)}{" "}
              <span style={{ color: "var(--text-muted)" }}>({diferencia(c.clave, c.anterior.valor, c.actual.valor)})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {vacio}
        </p>
      )}
    </div>
  );
}

/** Aviso corto en "Hoy" los domingos y lunes: ya está el resumen de la semana. */
export function AvisoResumenListo({ hoy, onVer }: { hoy: string; onVer: () => void }) {
  const dia = new Date(`${hoy}T00:00:00Z`).getUTCDay();
  if (dia !== 0 && dia !== 1) return null;
  return (
    <section className="tarjeta flex flex-wrap items-center justify-between gap-2 rounded-lg p-4">
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>
        {dia === 0 ? "Hoy cierra la semana: ya puedes ver tu resumen semanal." : "Ya está el resumen de la semana pasada."}
      </p>
      <button onClick={onVer} className="rounded-full px-3 py-1 text-xs font-medium" style={{ border: "1px solid var(--border)", color: "var(--marca)" }}>
        Ver resumen
      </button>
    </section>
  );
}

// ------------------------------------------------------------ relaciones

const enHoras = (v: number) => `${(v / 60).toFixed(1).replace(".0", "")} h`;
const ejeEstres = { formato: (v: number) => `${v}%`, dominio: [0, 100] as [number, number], marcas: [0, 25, 50, 75, 100] as number[] | undefined };
const ejeLibre = (formato: (v: number) => string) => ({ formato, dominio: ["auto", "auto"] as [string, string], marcas: undefined as number[] | undefined });

function ejeX(def: DefRelacion) {
  if (def.clave === "dormir-hrv") return ejeLibre((v) => relojDesde18(Math.round(v)));
  if (def.clave === "sueno-estres") return ejeLibre(enHoras);
  return ejeEstres;
}

function ejeY(def: DefRelacion) {
  if (def.clave === "estres-sueno") return ejeLibre(enHoras);
  if (def.clave === "sueno-estres") return ejeEstres;
  return ejeLibre((v) => `${v}`);
}

function textoPunto(def: DefRelacion, x: number, y: number): string[] {
  const fx = def.clave === "dormir-hrv" ? `Te dormiste a las ${relojDesde18(Math.round(x))}` : def.clave === "sueno-estres" ? `Dormiste ${horasMin(x)}` : `Estrés: ${x}% del tiempo en reposo`;
  const fy = def.clave === "estres-sueno" ? `Esa noche dormiste ${horasMin(y)}` : def.clave === "sueno-estres" ? `Estrés ese día: ${y}%` : `HRV: ${Math.round(y)} ms`;
  return [fx, fy];
}

function GraficaRelacion({ def, dias, estres, excluir }: { def: DefRelacion; dias: readonly DiaSalud[]; estres: readonly DiaEstres[]; excluir: ReadonlySet<string> }) {
  const pares = useMemo(() => paresDe(def.clave, dias, estres, excluir), [def, dias, estres, excluir]);
  const rel = useMemo(() => relacion(pares), [pares]);
  const xs = pares.map((p) => p.x);
  const linea =
    rel.n >= MINIMO_PARES && rel.pendiente !== null && rel.intercepto !== null
      ? ([
          { x: Math.min(...xs), y: rel.intercepto + rel.pendiente * Math.min(...xs) },
          { x: Math.max(...xs), y: rel.intercepto + rel.pendiente * Math.max(...xs) },
        ] as const)
      : null;
  return (
    <div>
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>
        {fraseRelacion(def, rel)}
      </p>
      {pares.length ? (
        <div className="mt-2 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: -8 }}>
              <CartesianGrid stroke="var(--gridline)" />
              <XAxis type="number" dataKey="x" domain={ejeX(def).dominio} ticks={ejeX(def).marcas} tickFormatter={ejeX(def).formato} tick={EJE} axisLine={false} tickLine={false}
                label={{ value: def.ejeX, position: "insideBottom", offset: -12, fill: "var(--text-muted)", fontSize: 11 }} />
              <YAxis type="number" dataKey="y" domain={ejeY(def).dominio} ticks={ejeY(def).marcas} tickFormatter={ejeY(def).formato} tick={EJE} axisLine={false} tickLine={false} width={48} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as { fecha: string; x: number; y: number };
                  return <Caja titulo={fechaCorta(p.fecha)} lineas={textoPunto(def, p.x, p.y)} />;
                }}
              />
              {linea && <ReferenceLine segment={[...linea]} stroke="var(--text-muted)" strokeDasharray="4 3" ifOverflow="extendDomain" />}
              <Scatter data={pares} fill="var(--series-1)" isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-2">
          <Vacio>Aún no hay días con ambos datos.</Vacio>
        </div>
      )}
    </div>
  );
}

export function RelacionesSalud({ dias, estres, diasViaje }: { dias: readonly DiaSalud[]; estres: readonly DiaEstres[]; diasViaje: ReadonlySet<string> }) {
  const [sinViajes, setSinViajes] = useState(false);
  const excluir = useMemo(() => (sinViajes ? diasViaje : new Set<string>()), [sinViajes, diasViaje]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Cada punto es un día. La línea punteada es la tendencia. Son asociaciones, no causas: con pocos días cualquier patrón puede ser casualidad.
        </p>
        {diasViaje.size > 0 && (
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={sinViajes} onChange={(e) => setSinViajes(e.target.checked)} />
            Quitar días de viaje
          </label>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {RELACIONES.map((def) => (
          <section key={def.clave} className="tarjeta rounded-lg p-4">
            <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {def.titulo}
            </h3>
            <div className="mt-2">
              <GraficaRelacion def={def} dias={dias} estres={estres} excluir={excluir} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- viajes

const OFFSETS = [
  { v: "", t: "Igual que la laptop (automático)" },
  { v: "-480", t: "UTC−8 · Pacífico (Las Vegas, invierno)" },
  { v: "-420", t: "UTC−7 · Pacífico en verano / Montaña" },
  { v: "-360", t: "UTC−6 · Centro (CDMX)" },
  { v: "-300", t: "UTC−5 · Este (invierno) / Cancún" },
  { v: "-240", t: "UTC−4 · Este en verano" },
  { v: "0", t: "UTC+0 · Londres (invierno)" },
  { v: "60", t: "UTC+1 · Madrid (invierno)" },
  { v: "120", t: "UTC+2 · Madrid en verano" },
];

function FormularioViaje({ inicial, onGuardado, onCancelar }: { inicial: Partial<Viaje>; onGuardado: () => void; onCancelar: () => void }) {
  const [lugar, setLugar] = useState(inicial.lugar ?? "");
  const [desde, setDesde] = useState(inicial.desde ?? "");
  const [hasta, setHasta] = useState(inicial.hasta ?? "");
  const [offset, setOffset] = useState(inicial.offset == null ? "" : String(inicial.offset));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campo = "rounded-md px-2 py-2 text-sm sm:py-1";
  const estilo = { border: "1px solid var(--border)", background: "var(--surface-1)", color: "var(--text-primary)" };
  const guardar = async () => {
    const v = { id: inicial.id, lugar, desde, hasta: hasta || null, offset: offset === "" ? null : Number(offset) };
    const p = problemaViaje(v);
    if (p) return setError(p);
    setGuardando(true);
    setError(null);
    try {
      await guardarViaje(v);
      onGuardado();
    } catch (e) {
      setError(`No se pudo guardar: ${(e as { message?: string }).message ?? "error desconocido"}`);
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          Lugar
          <input className={campo} style={estilo} value={lugar} maxLength={80} onChange={(e) => setLugar(e.target.value)} placeholder="Las Vegas" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          Salida
          <input type="date" className={campo} style={estilo} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          Regreso (vacío = sigues ahí)
          <input type="date" className={campo} style={estilo} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          Zona horaria del destino
          <select className={campo} style={estilo} value={offset} onChange={(e) => setOffset(e.target.value)}>
            {OFFSETS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="mt-2 text-xs" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button disabled={guardando} onClick={guardar} className="rounded-full px-4 py-2 text-xs font-medium text-white disabled:opacity-60 sm:py-1" style={{ background: "var(--marca)" }}>
          {guardando ? "Guardando…" : "Guardar viaje"}
        </button>
        <button onClick={onCancelar} className="rounded-full px-4 py-2 text-xs font-medium sm:py-1" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function celdaTramo(f: FilaEfecto, t: ValorTramo, referencia: ValorTramo | null) {
  const v = referencia ? veredicto(f.clave, f.mejorAlto, referencia, t) : null;
  const dif = referencia ? diferencia(f.clave, referencia.valor, t.valor) : null;
  return (
    <td className="py-1.5 text-right align-top">
      <span style={{ color: "var(--text-primary)" }}>{formato(f.clave, t.valor)}</span>
      {t.n > 0 && <span style={{ color: "var(--text-muted)" }}> ({t.n} d)</span>}
      {v && v !== "sin-dato" && (
        <div className="text-[11px]" style={{ color: VEREDICTO[v].color }}>
          {VEREDICTO[v].icono} {dif}
        </div>
      )}
    </td>
  );
}

function GraficaViaje({ dias, viaje, hasta }: { dias: readonly DiaSalud[]; viaje: Viaje; hasta: string }) {
  const desde = restarDias(viaje.desde, DIAS_ANTES_VIAJE);
  const fin = restarDias(hasta, -DIAS_REGRESO);
  const datos = dias
    .filter((d) => d.fecha >= desde && d.fecha <= fin)
    .map((d) => {
      const m = minutosDormido(d.noche);
      return { fecha: d.fecha, horas: m === null ? null : Math.round((m / 60) * 10) / 10, hrv: num(d.noche?.hrv_ms) };
    });
  if (!datos.some((d) => d.horas !== null || d.hrv !== null)) return <Vacio>No hay noches alrededor de este viaje.</Vacio>;
  const ultimo = datos.at(-1)?.fecha ?? hasta;
  return (
    <div>
      <Leyenda
        items={[
          { color: "var(--series-1)", texto: "Horas de sueño (barras)" },
          { color: "var(--series-2)", texto: "HRV, ms (línea)" },
          { color: "color-mix(in srgb, var(--text-muted) 30%, transparent)", texto: "Días de viaje" },
        ]}
      />
      <div className="mt-2 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={datos} margin={{ top: 4, right: 0, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="fecha" tickFormatter={fechaCorta} tick={EJE} axisLine={false} tickLine={false} />
            <YAxis yAxisId="h" tick={EJE} axisLine={false} tickLine={false} tickFormatter={(v) => `${v} h`} />
            <YAxis yAxisId="hrv" orientation="right" tick={EJE} axisLine={false} tickLine={false} width={36} domain={["auto", "auto"]} />
            <ReferenceArea yAxisId="h" x1={viaje.desde} x2={hasta < ultimo ? hasta : ultimo} fill="var(--text-muted)" fillOpacity={0.18} ifOverflow="hidden" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof datos)[number];
                const enViaje = p.fecha >= viaje.desde && p.fecha <= hasta;
                return (
                  <Caja
                    titulo={`${fechaCorta(p.fecha)}${enViaje ? ` · ${viaje.lugar}` : ""}`}
                    lineas={[p.horas === null ? "Sin noche" : `Sueño: ${p.horas} h`, p.hrv === null ? null : `HRV: ${Math.round(p.hrv)} ms`]}
                  />
                );
              }}
            />
            <Bar yAxisId="h" dataKey="horas" fill="var(--series-1)" maxBarSize={18} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line yAxisId="hrv" dataKey="hrv" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function VistaViajes({
  dias,
  estres,
  viajes,
  zonas,
  hoy,
  error,
  onCambio,
}: {
  dias: readonly DiaSalud[];
  estres: readonly DiaEstres[];
  viajes: readonly Viaje[] | null;
  zonas: ReadonlyMap<string, number>;
  hoy: string;
  error: string | null;
  onCambio: () => void;
}) {
  const [editando, setEditando] = useState<Partial<Viaje> | null>(null);
  const [borrando, setBorrando] = useState<number | null>(null);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);
  const lista = useMemo(() => [...(viajes ?? [])].sort((a, b) => b.desde.localeCompare(a.desde)), [viajes]);
  const sinMarcar = useMemo(() => tramosSinMarcar(tramosFueraDeCasa(zonas), viajes ?? [], hoy), [zonas, viajes, hoy]);
  const [elegido, setElegido] = useState<number | null>(null);
  const viaje = lista.find((v) => v.id === elegido) ?? lista[0];
  const efecto = useMemo(() => (viaje ? efectoViaje(dias, estres, viaje, hoy, zonas) : null), [dias, estres, viaje, hoy, zonas]);

  const borrar = async (id: number) => {
    setErrorBorrar(null);
    try {
      await borrarViaje(id);
      setBorrando(null);
      onCambio();
    } catch (e) {
      setErrorBorrar(`No se pudo borrar: ${(e as { message?: string }).message ?? "error"}`);
    }
  };
  const marcarTramo = (t: TramoFuera) => setEditando({ desde: t.desde, hasta: t.hasta >= restarDias(hoy, 1) ? null : t.hasta, offset: t.offset });

  if (error) return <Vacio>{error}</Vacio>;
  if (!viajes) return <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Cargando viajes…</p>;
  return (
    <div className="space-y-4">
      {sinMarcar.map((t) => (
        <div key={t.desde} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm" style={{ border: "1px dashed var(--border)" }}>
          <span style={{ color: "var(--text-primary)" }}>
            La laptop estuvo en otra zona horaria ({textoZona(t.offset)}) del {fechaCorta(t.desde)} al {fechaCorta(t.hasta)}. ¿Fue un viaje?
          </span>
          <button onClick={() => marcarTramo(t)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ border: "1px solid var(--border)", color: "var(--marca)" }}>
            Marcar como viaje
          </button>
        </div>
      ))}

      {editando ? (
        <FormularioViaje
          inicial={editando}
          onCancelar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            onCambio();
          }}
        />
      ) : (
        <button onClick={() => setEditando({})} className="rounded-full px-4 py-2 text-xs font-medium text-white sm:py-1" style={{ background: "var(--marca)" }}>
          + Marcar un viaje
        </button>
      )}

      {!lista.length ? (
        <Vacio>Aún no hay viajes marcados. Marca uno con su salida y regreso para ver cómo te afectó.</Vacio>
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {lista.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setElegido(v.id)}
                  aria-pressed={viaje?.id === v.id}
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    border: "1px solid var(--border)",
                    background: viaje?.id === v.id ? "var(--marca)" : "var(--surface-1)",
                    color: viaje?.id === v.id ? "#fff" : "var(--text-secondary)",
                  }}
                >
                  {v.lugar} · {fechaCorta(v.desde)}–{v.hasta ? fechaCorta(v.hasta) : "hoy"}
                </button>
                <button onClick={() => setEditando(v)} className="text-xs underline" style={{ color: "var(--marca)" }}>
                  Editar
                </button>
                {borrando === v.id ? (
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    ¿Borrar este viaje?{" "}
                    <button onClick={() => borrar(v.id)} className="underline" style={{ color: "var(--status-critical)" }}>
                      Sí, borrar
                    </button>{" "}
                    <button onClick={() => setBorrando(null)} className="underline">
                      No
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setBorrando(v.id)} className="text-xs underline" style={{ color: "var(--text-muted)" }}>
                    Borrar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {errorBorrar && <p className="text-xs" style={{ color: "var(--status-critical)" }}>{errorBorrar}</p>}

          {efecto && viaje && (
            <section className="tarjeta space-y-3 rounded-lg p-4">
              <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {viaje.lugar}: del {fechaLarga(viaje.desde)} al {viaje.hasta ? fechaLarga(viaje.hasta) : "hoy (sigue en curso)"}
              </h3>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {efecto.cambioHoras === null
                  ? "Cambio de horario: sin dato (elige la zona del destino al editar el viaje)."
                  : efecto.cambioHoras === 0
                    ? "Mismo horario que en casa."
                    : `Cambio de horario: ${Math.abs(efecto.cambioHoras)} h ${efecto.cambioHoras < 0 ? "menos" : "más"} que en Ciudad de México.`}{" "}
                Se compara contra tus {DIAS_ANTES_VIAJE} días antes de salir{viaje.hasta ? ` y los ${DIAS_REGRESO} días al regresar` : ""}.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[18rem] text-xs" style={{ color: "var(--text-secondary)" }}>
                  <thead>
                    <tr style={{ color: "var(--text-muted)" }}>
                      <th className="py-1 text-left font-medium">Indicador</th>
                      <th className="py-1 text-right font-medium">Antes</th>
                      <th className="py-1 text-right font-medium">Durante</th>
                      {viaje.hasta && <th className="py-1 text-right font-medium">Al regresar</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {efecto.filas.map((f) => (
                      <tr key={f.clave} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="py-1.5 align-top">{f.nombre}</td>
                        {celdaTramo(f, f.antes, null)}
                        {celdaTramo(f, f.durante, f.antes)}
                        {viaje.hasta && celdaTramo(f, f.despues, f.antes)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <GraficaViaje dias={dias} viaje={viaje} hasta={efecto.hasta} />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Las horas de dormir están en el reloj de la laptop: si la laptop cambió de zona, también las noches de antes pueden verse en la hora
                del destino.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
