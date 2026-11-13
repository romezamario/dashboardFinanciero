import { useEffect, useMemo, useState } from "react";
import {
  mensajeErrorSalud,
  obtenerDiasSalud,
  obtenerBateria,
  obtenerUltimaSubida,
  ultimosDias,
  type DiaSalud,
  type LecturaBateria,
} from "./salud";
import { MarcoEspacio } from "../../components/MarcoEspacio";
import type { PropsEspacio } from "../../lib/espacios";
import {
  ActividadDiaria,
  CalendarioSueno,
  FasesPorNoche,
  HRDelDia,
  Hipnograma,
  HorarioSueno,
  Panel,
  SenalesNoche,
  TarjetaBateria,
  TarjetasHoy,
  Temperatura,
  Tendencia,
  Vacio,
} from "./GraficasSalud";
import { BloquesSueno, ConstanciaHorario, EstresDelDia, TarjetaRecuperacion, TemperaturaDelDia } from "./IndicadoresSalud";

const PERIODOS = [
  { dias: 7, texto: "7 días" },
  { dias: 30, texto: "30 días" },
  { dias: 90, texto: "90 días" },
] as const;

const leerHRV = (d: DiaSalud) => d.noche?.hrv_ms ?? null;
const leerRHR = (d: DiaSalud) => d.noche?.rhr ?? null;
const leerSpO2 = (d: DiaSalud) => d.noche?.spo2_mean ?? null;
const leerRespiracion = (d: DiaSalud) => d.noche?.breath_rate ?? null;

/** Espacio Salud del dashboard personal: datos del anillo Oura que sube el
 * colector de la laptop (esquema `salud` de Supabase). */
export default function Salud({ onIrAInicio }: PropsEspacio) {
  const [dias, setDias] = useState<DiaSalud[] | null>(null);
  const [ultimaSubida, setUltimaSubida] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [periodo, setPeriodo] = useState<number>(30);
  const [noche, setNoche] = useState<string | null>(null);
  const [bateria, setBateria] = useState<LecturaBateria[] | null>(null);

  useEffect(() => {
    let vigente = true;
    obtenerBateria()
      .then((b) => vigente && setBateria(b))
      .catch(() => vigente && setBateria([]));
    Promise.all([obtenerDiasSalud(), obtenerUltimaSubida()])
      .then(([d, s]) => {
        if (!vigente) return;
        setDias(d);
        setUltimaSubida(s);
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
        <Panel titulo="Batería del anillo">
          <TarjetaBateria lecturas={bateria} />
        </Panel>
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
            <Panel titulo="Recuperación de hoy">
              <TarjetaRecuperacion dias={dias} />
            </Panel>

            <TarjetasHoy dias={dias} />

            <Panel
              titulo={`Fases de sueño · noche que terminó el ${nocheElegida ? nocheElegida.fecha.split("-").reverse().join("/") : "—"}`}
              nota="Fases calculadas por open_health a partir de las señales del anillo."
            >
              <Hipnograma dia={nocheElegida} />
            </Panel>

            <Panel titulo="Sueño de ese día en bloques (noche y siestas)">
              <BloquesSueno dia={nocheElegida} />
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
              <Panel titulo="Oxígeno en sangre (SpO2) por noche (%)" nota="Normal: 95–100%. Bajadas repetidas de noche pueden indicar pausas al respirar.">
                <Tendencia dias={enPeriodo} leer={leerSpO2} color="var(--series-1)" unidad="%" vacio="Aún no hay SpO2 nocturno." />
              </Panel>
              <Panel titulo="Respiración por noche (resp/min)" nota="Suele subir uno o dos días antes de enfermarte.">
                <Tendencia dias={enPeriodo} leer={leerRespiracion} color="var(--series-2)" unidad="resp/min" vacio="Aún no hay frecuencia respiratoria." decimales={1} />
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel titulo="Temperatura de la piel vs. tu línea base (°C)">
                <Temperatura dias={enPeriodo} />
              </Panel>
              <Panel titulo="Horario de sueño (hora de dormir → despertar)">
                <ConstanciaHorario dias={enPeriodo} />
                <div className="mt-2">
                  <HorarioSueno dias={enPeriodo} />
                </div>
              </Panel>
            </div>

            <Panel titulo="Estrés durante el día">
              <EstresDelDia dias={dias} />
            </Panel>

            <Panel titulo="Temperatura de la piel a lo largo del día">
              <TemperaturaDelDia dias={dias} />
            </Panel>

            <Panel titulo="Actividad por día" nota="Pasos y calorías los calcula open_health con el movimiento del anillo.">
              <ActividadDiaria dias={enPeriodo} />
            </Panel>

            <Panel titulo="Ritmo cardiaco a lo largo del día" nota="Incluye las lecturas de día (HR diurno) y de noche.">
              <HRDelDia dias={enPeriodo} />
            </Panel>
          </>
        )}
    </MarcoEspacio>
  );
}
