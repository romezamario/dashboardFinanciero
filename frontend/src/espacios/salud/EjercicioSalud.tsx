// Sesiones de ejercicio en la pestaña Actividad (Mario, 2026-11-15), agrupadas
// por día y con su tipo (correr, caminata…) sugerido o confirmado (2026-11-17). Cálculos
// en ejercicio.ts; los datos los arma el colector de la laptop.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DiaSalud } from "./salud";
import { Caja, Leyenda, Vacio } from "./GraficasSalud";
import { EJE, fechaCorta, horasMin } from "./formatoSalud";
import {
  META_SEMANAL_MIN,
  MINIMO_EJEMPLOS,
  TIPOS_ACTIVIDAD,
  aplicarGuardadas,
  confirmarTipos,
  diasConEjercicio,
  ejemplosConfirmados,
  horaEnZona,
  minutosPorDia,
  obtenerEtiquetasEjercicio,
  resumenEjercicio,
  sesionesRecientes,
  sinDescartadas,
  tipoActividad,
  type DiaEjercicio,
  type EtiquetaEjercicio,
  type MinutosDia,
  type SesionEtiquetada,
} from "./ejercicio";

const COLOR_MODERADO = "var(--series-1)";
const COLOR_VIGOROSO = "var(--series-2)";
const VISIBLES = 7;
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

function SelectorTipo({ onElegir, etiqueta, deshabilitado }: { onElegir: (tipo: string) => void; etiqueta: string; deshabilitado?: boolean }) {
  return (
    <select
      aria-label={etiqueta}
      className="rounded-md px-1.5 py-1 text-xs sm:py-0.5"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
      value=""
      disabled={deshabilitado}
      onChange={(e) => e.target.value && onElegir(e.target.value)}
    >
      <option value="">{etiqueta}…</option>
      {TIPOS_ACTIVIDAD.map((t) => (
        <option key={t.id} value={t.id}>
          {t.icono} {t.nombre}
        </option>
      ))}
    </select>
  );
}

function ChipTipo({ tipo, confirmada, texto }: { tipo: string; confirmada: boolean; texto?: string }) {
  const t = tipoActividad(tipo);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
      style={{ border: `1px ${confirmada ? "solid var(--marca)" : "dashed var(--text-muted)"}`, color: "var(--text-primary)" }}
    >
      <span aria-hidden>{t.icono}</span>
      {t.nombre}
      {texto && <span style={{ color: "var(--text-secondary)" }}>{texto}</span>}
      {confirmada ? <span aria-label="confirmada">✓</span> : <span style={{ color: "var(--text-muted)" }}>· sugerida</span>}
    </span>
  );
}

function FilaSesion({ s, onTipo, ocupado }: { s: SesionEtiquetada; onTipo: (s: SesionEtiquetada, tipo: string) => void; ocupado: boolean }) {
  const inicio = s.hora ?? horaEnZona(s.inicio, s.utc_offset_min);
  const fin = horaEnZona(s.fin, s.utc_offset_min);
  const detalles = [
    s.intensidad === "vigorosa" ? "vigorosa" : "moderada",
    `MET ${s.met_prom.toLocaleString("es-MX", { maximumFractionDigits: 1 })}`,
    typeof s.lpm_mediana === "number" ? `FC ${s.lpm_mediana} lpm${typeof s.lpm_max === "number" ? ` (pico ${s.lpm_max})` : ""}` : "sin FC",
    typeof s.kcal === "number" ? `${s.kcal} kcal` : null,
  ].filter(Boolean);
  return (
    <li className="py-2 text-sm" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
          {inicio}–{fin} · {duracion(s.duracion_min)}
        </span>
        <ChipTipo tipo={s.tipo} confirmada={s.confirmada} />
        {!s.confirmada && (
          <button
            className="rounded-md px-2 py-1 text-xs sm:py-0.5"
            style={{ border: "1px solid var(--marca)", color: "var(--marca)" }}
            disabled={ocupado}
            onClick={() => onTipo(s, s.tipo)}
          >
            Sí, {tipoActividad(s.tipo).nombre.toLowerCase()}
          </button>
        )}
        <SelectorTipo etiqueta={s.confirmada ? "Cambiar" : "Otra"} onElegir={(t) => onTipo(s, t)} deshabilitado={ocupado} />
      </div>
      <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
        {detalles.join(" · ")}
        {!s.confirmada && s.motivo ? ` · sugerida por ${s.motivo}` : ""}
      </p>
    </li>
  );
}

function FilaDia({
  d,
  abierto,
  onAlternar,
  onConfirmar,
  ocupado,
}: {
  d: DiaEjercicio;
  abierto: boolean;
  onAlternar: () => void;
  onConfirmar: (sesiones: SesionEtiquetada[], tipo?: string) => void;
  ocupado: boolean;
}) {
  const pendientes = d.sesiones.filter((s) => !s.confirmada);
  const descartadas = d.sesiones.filter((s) => s.tipo === "no_ejercicio").length;
  const resumen = [
    `${d.sesiones.length} ${d.sesiones.length === 1 ? "sesión" : "sesiones"}`,
    duracion(d.minutos),
    d.kcal === null ? null : `${d.kcal.toLocaleString("es-MX")} kcal`,
    descartadas ? `${descartadas} sin contar` : null,
  ].filter(Boolean);
  return (
    <li className="py-2.5" style={{ borderTop: "1px solid var(--border)" }}>
      <button className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 text-left text-sm" onClick={onAlternar} aria-expanded={abierto}>
        <span className="w-24 shrink-0 font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
          {diaSemana(d.fecha)} {fechaCorta(d.fecha)}
        </span>
        <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
          {resumen.join(" · ")}
        </span>
        <span className="ml-auto text-xs" style={{ color: "var(--marca)" }}>
          {abierto ? "Ocultar ▴" : "Ver sesiones ▾"}
        </span>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {d.tipos.map((t) => (
          <ChipTipo key={t.tipo} tipo={t.tipo} confirmada={!d.sesiones.some((s) => s.tipo === t.tipo && !s.confirmada)} texto={duracion(t.minutos)} />
        ))}
        {!d.tipos.length && <ChipTipo tipo="no_ejercicio" confirmada={!pendientes.length} />}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        {pendientes.length > 0 && (
          <button
            className="rounded-md px-2 py-1 sm:py-0.5"
            style={{ background: "var(--marca)", color: "white" }}
            disabled={ocupado}
            onClick={() => onConfirmar(pendientes)}
          >
            Confirmar {pendientes.length === 1 ? "la sugerencia" : `las ${pendientes.length} sugerencias`}
          </button>
        )}
        <SelectorTipo etiqueta="Todo el día como" onElegir={(t) => onConfirmar(d.sesiones, t)} deshabilitado={ocupado} />
      </div>
      {abierto && (
        <ul className="mt-2 sm:pl-4">
          {d.sesiones.map((s) => (
            <FilaSesion key={s.inicio} s={s} onTipo={(ses, tipo) => onConfirmar([ses], tipo)} ocupado={ocupado} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** `historia` = todos los días cargados (no solo el periodo): de ahí salen los
 * ejemplos confirmados para sugerir el tipo. */
export function EjercicioSalud({ dias, historia = dias }: { dias: readonly DiaSalud[]; historia?: readonly DiaSalud[] }) {
  const sesiones = useMemo(() => sesionesRecientes(dias), [dias]);
  const [todos, setTodos] = useState(false);
  const [etiquetas, setEtiquetas] = useState<EtiquetaEjercicio[]>([]);
  const [errorEtiquetas, setErrorEtiquetas] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let vigente = true;
    obtenerEtiquetasEjercicio()
      .then((e) => vigente && setEtiquetas(e))
      .catch((e: unknown) => vigente && setErrorEtiquetas(`No se pudieron leer los tipos guardados: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      vigente = false;
    };
  }, []);
  const ejemplos = useMemo(() => ejemplosConfirmados(historia, etiquetas), [historia, etiquetas]);
  const contables = useMemo(() => sinDescartadas(dias, etiquetas), [dias, etiquetas]);
  const resumen = useMemo(() => resumenEjercicio(contables), [contables]);
  const porDia = useMemo(() => minutosPorDia(contables), [contables]);
  const porDiaEtiquetado = useMemo(() => diasConEjercicio(dias, etiquetas, ejemplos), [dias, etiquetas, ejemplos]);
  const confirmar = useCallback(async (lista: SesionEtiquetada[], tipo?: string) => {
    setGuardando(true);
    setErrorEtiquetas(null);
    try {
      const guardadas = await confirmarTipos(lista, tipo);
      setEtiquetas((actuales) => aplicarGuardadas(actuales, guardadas, lista));
    } catch (e) {
      setErrorEtiquetas(`No se guardó: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGuardando(false);
    }
  }, []);
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
  const visibles = todos ? porDiaEtiquetado : porDiaEtiquetado.slice(0, VISIBLES);
  const alternar = (fecha: string) =>
    setAbiertos((a) => {
      const n = new Set(a);
      if (n.has(fecha)) n.delete(fecha);
      else n.add(fecha);
      return n;
    });
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
      <p className="mt-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        Por día. Confirma o corrige el tipo: con {MINIMO_EJEMPLOS} o más confirmadas, la sugerencia sale de tus sesiones más parecidas.
      </p>
      {errorEtiquetas && (
        <p className="mt-1 text-xs" style={{ color: "var(--status-critical)" }} role="alert">
          {errorEtiquetas}
        </p>
      )}
      <ul className="mt-1">
        {visibles.map((d) => (
          <FilaDia
            key={d.fecha}
            d={d}
            abierto={abiertos.has(d.fecha)}
            onAlternar={() => alternar(d.fecha)}
            onConfirmar={(l, t) => void confirmar(l, t)}
            ocupado={guardando}
          />
        ))}
      </ul>
      {porDiaEtiquetado.length > VISIBLES && (
        <button className="mt-2 text-xs underline" style={{ color: "var(--marca)" }} onClick={() => setTodos(!todos)}>
          {todos ? "Ver menos" : `Ver los ${porDiaEtiquetado.length} días`}
        </button>
      )}
    </div>
  );
}
