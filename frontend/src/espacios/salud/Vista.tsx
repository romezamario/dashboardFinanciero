import { useEffect, useMemo, useState } from "react";
import {
  mensajeErrorSalud,
  obtenerDiasSalud,
  obtenerGastoPorDia,
  obtenerUltimaSubida,
  ultimosDias,
  type DiaSalud,
} from "./salud";
import { MarcoEspacio } from "../../components/MarcoEspacio";
import type { PropsEspacio } from "../../lib/espacios";
import {
  ActividadDiaria,
  CalendarioSueno,
  CruceSuenoGasto,
  FasesPorNoche,
  HRDelDia,
  Hipnograma,
  HorarioSueno,
  Panel,
  SenalesNoche,
  TarjetasHoy,
  Temperatura,
  Tendencia,
  Vacio,
} from "./GraficasSalud";

const PERIODOS = [
  { dias: 7, texto: "7 días" },
  { dias: 30, texto: "30 días" },
  { dias: 90, texto: "90 días" },
] as const;

const leerHRV = (d: DiaSalud) => d.noche?.hrv_ms ?? null;
const leerRHR = (d: DiaSalud) => d.noche?.rhr ?? null;

/** Espacio Salud del dashboard personal: datos del anillo Oura que sube el
 * colector de la laptop (esquema `salud` de Supabase). */
export default function Salud({ onIrAInicio }: PropsEspacio) {
  const [dias, setDias] = useState<DiaSalud[] | null>(null);
  const [ultimaSubida, setUltimaSubida] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [periodo, setPeriodo] = useState<number>(30);
  const [noche, setNoche] = useState<string | null>(null);
  const [gasto, setGasto] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    let vigente = true;
    Promise.all([obtenerDiasSalud(), obtenerUltimaSubida()])
      .then(([d, s]) => {
        if (!vigente) return;
        setDias(d);
        setUltimaSubida(s);
        if (d.length) {
          obtenerGastoPorDia(d[0].fecha, d.at(-1)!.fecha)
            .then((g) => vigente && setGasto(g))
            .catch(() => vigente && setGasto(new Map()));
        }
      })
      .catch((e) => vigente && setError(mensajeErrorSalud(e)));
    return () => {
      vigente = false;
    };
  }, [intento]);

  const enPeriodo = useMemo(() => (dias ? ultimosDias(dias, periodo) : []), [dias, periodo]);
  const conNoche = useMemo(() => (dias ?? []).filter((d) => d.noche), [dias]);
  const nocheElegida = conNoche.find((d) => d.fecha === noche) ?? conNoche.at(-1);

  return (
    <MarcoEspacio
      titulo="Salud"
      onIrAInicio={onIrAInicio}
      acciones={
        ultimaSubida && (
          <span className="hidden text-xs lg:inline" style={{ color: "var(--text-muted)" }}>
            Última subida: {new Date(ultimaSubida).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )
      }
    >
        {error ? (
          <section className="tarjeta rounded-lg p-5">
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              {error}
            </p>
            <button
              onClick={() => {
                setError(null);
                setIntento((n) => n + 1);
              }}
              className="mt-3 rounded-full px-3 py-1 text-xs font-medium"
              style={{ border: "1px solid var(--border)", color: "var(--marca)" }}
            >
              Reintentar
            </button>
          </section>
        ) : !dias ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Cargando…
          </p>
        ) : !dias.length ? (
          <Vacio>
            Aún no hay datos del anillo. Aparecerán aquí cuando la laptop sincronice el anillo Oura
            (<code>py colector\subir_oura.py</code>).
          </Vacio>
        ) : (
          <>
            <TarjetasHoy dias={dias} />

            <Panel
              titulo={`Fases de sueño · noche que terminó el ${nocheElegida ? nocheElegida.fecha.split("-").reverse().join("/") : "—"}`}
              nota="Fases calculadas por open_health a partir de las señales del anillo."
            >
              <Hipnograma dia={nocheElegida} />
            </Panel>

            <Panel titulo="Ritmo cardiaco y HRV durante esa noche">
              <SenalesNoche dia={nocheElegida} />
            </Panel>

            <Panel titulo="Calendario de sueño">
              <CalendarioSueno dias={dias} seleccion={nocheElegida?.fecha ?? null} onSeleccionar={setNoche} />
            </Panel>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Periodo de las tendencias">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Tendencias:
              </span>
              {PERIODOS.map((p) => (
                <button
                  key={p.dias}
                  onClick={() => setPeriodo(p.dias)}
                  aria-pressed={periodo === p.dias}
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    border: "1px solid var(--border)",
                    background: periodo === p.dias ? "var(--marca)" : "var(--surface-1)",
                    color: periodo === p.dias ? "#fff" : "var(--text-secondary)",
                  }}
                >
                  {p.texto}
                </button>
              ))}
            </div>

            <Panel titulo="Sueño por noche (meta 8 h) y deuda acumulada">
              <FasesPorNoche dias={enPeriodo} />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel titulo="HRV por noche (ms)">
                <Tendencia dias={enPeriodo} leer={leerHRV} color="var(--series-1)" unidad="ms" vacio="Aún no hay HRV nocturna." />
              </Panel>
              <Panel titulo="HR en reposo por noche (lpm)">
                <Tendencia dias={enPeriodo} leer={leerRHR} color="var(--series-2)" unidad="lpm" vacio="Aún no hay HR en reposo." />
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel titulo="Temperatura de la piel vs. tu línea base (°C)">
                <Temperatura dias={enPeriodo} />
              </Panel>
              <Panel titulo="Horario de sueño (hora de dormir → despertar)">
                <HorarioSueno dias={enPeriodo} />
              </Panel>
            </div>

            <Panel titulo="Actividad por día" nota="Pasos y calorías los calcula open_health con el movimiento del anillo.">
              <ActividadDiaria dias={enPeriodo} />
            </Panel>

            <Panel titulo="Ritmo cardiaco a lo largo del día">
              <HRDelDia dias={enPeriodo} />
            </Panel>

            <Panel
              titulo="Salud × Finanzas: horas dormidas vs. gasto del día"
              nota="Gasto = avisos de compra por correo (Gastos recientes) de ese día."
            >
              <CruceSuenoGasto dias={enPeriodo} gasto={gasto} />
            </Panel>
          </>
        )}
    </MarcoEspacio>
  );
}
