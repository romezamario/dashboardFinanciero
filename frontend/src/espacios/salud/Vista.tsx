import { useEffect, useMemo, useState } from "react";
import {
  mensajeErrorSalud,
  obtenerDiaCompleto,
  obtenerDiasSalud,
  obtenerBateria,
  obtenerUltimaSubida,
  ultimosDias,
  type DiaSalud,
  type LecturaBateria,
} from "./salud";
import { MarcoEspacio } from "../../components/MarcoEspacio";
import { Segmentado } from "../../components/Segmentado";
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
import { BloquesSueno, ConstanciaHorario, EstresDelDia, TemperaturaDelDia } from "./IndicadoresSalud";
import { HistorialPuntuaciones, PuntuacionesHoy } from "./PuntuacionesSalud";
import { estresDiurno } from "./indicadores";
import { EjercicioSalud } from "./EjercicioSalud";
import { obtenerEstadoColector, obtenerZonas, zonaPorDia, type EstadoColector, type LecturaZona } from "./colector";
import { fechasDeViaje, obtenerViajes, type Viaje } from "./viajes";
import { AvisoColector, AvisoResumenListo, RelacionesSalud, ResumenSemanal, VistaViajes } from "./SemanaViajesRelaciones";
import { hoyIso } from "../../lib/fechas";

const PERIODOS = [
  { dias: 7, texto: "7 días" },
  { dias: 30, texto: "30 días" },
  { dias: 90, texto: "90 días" },
] as const;

type Pestana = "hoy" | "semana" | "sueno-noche" | "sueno" | "corazon" | "temperatura" | "actividad" | "relaciones" | "viajes";
const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: "hoy", etiqueta: "Hoy" },
  { id: "semana", etiqueta: "Semana" },
  { id: "sueno-noche", etiqueta: "Noche" },
  { id: "sueno", etiqueta: "Sueño" },
  { id: "corazon", etiqueta: "Corazón y estrés" },
  { id: "temperatura", etiqueta: "Temperatura y respiración" },
  { id: "actividad", etiqueta: "Actividad" },
  { id: "relaciones", etiqueta: "Relaciones" },
  { id: "viajes", etiqueta: "Viajes" },
];
const CLAVE_PESTANA = "salud:pestana";
function pestanaGuardada(): Pestana {
  try {
    const v = sessionStorage.getItem(CLAVE_PESTANA);
    if (PESTANAS.some((p) => p.id === v)) return v as Pestana;
  } catch {
    /* sin almacenamiento: pestaña por defecto */
  }
  return "hoy";
}

/** Horas sin subida de la laptop desde las que "Última subida" lleva ⚠ (la
 * misma ventana del aviso de Windows del colector). */
const HORAS_SUBIDA_VIEJA = 6;

const leerHRV = (d: DiaSalud) => d.noche?.hrv_ms ?? null;
const leerRHR = (d: DiaSalud) => d.noche?.rhr ?? null;
const leerSpO2 = (d: DiaSalud) => d.noche?.spo2_mean ?? null;
const leerRespiracion = (d: DiaSalud) => d.noche?.breath_rate ?? null;

/** Espacio Salud del dashboard personal: datos del anillo Oura que sube el
 * colector de la laptop (esquema `salud` de Supabase). */
export default function Salud({ onIrAInicio }: PropsEspacio) {
  const [dias, setDias] = useState<DiaSalud[] | null>(null);
  const [ultimaSubida, setUltimaSubida] = useState<string | null>(null);
  const [subidaVieja, setSubidaVieja] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [periodo, setPeriodo] = useState<number>(30);
  const [noche, setNoche] = useState<string | null>(null);
  // undefined = cargando, null = nunca se ha leído.
  const [bateria, setBateria] = useState<LecturaBateria | null | undefined>(undefined);
  // Noches viejas llegan sin hipnograma ni FC (vista ligera): se piden al abrirlas.
  const [completas, setCompletas] = useState<Record<string, DiaSalud | null>>({});
  const [pestana, setPestana] = useState<Pestana>(pestanaGuardada);
  const [estadoColector, setEstadoColector] = useState<EstadoColector | null>(null);
  const [viajes, setViajes] = useState<Viaje[] | null>(null);
  const [errorViajes, setErrorViajes] = useState<string | null>(null);
  const [zonas, setZonas] = useState<LecturaZona[]>([]);
  const [intentoViajes, setIntentoViajes] = useState(0);
  const hoy = hoyIso();
  const cambiarPestana = (p: Pestana) => {
    setPestana(p);
    try {
      sessionStorage.setItem(CLAVE_PESTANA, p);
    } catch {
      /* no se recuerda, sin problema */
    }
  };

  useEffect(() => {
    let vigente = true;
    obtenerBateria()
      .then((b) => vigente && setBateria(b))
      .catch(() => vigente && setBateria(null));
    Promise.all([obtenerDiasSalud(), obtenerUltimaSubida()])
      .then(([d, s]) => {
        if (!vigente) return;
        setDias(d);
        setUltimaSubida(s);
        setSubidaVieja(!!s && Date.now() - new Date(s).getTime() > HORAS_SUBIDA_VIEJA * 3600 * 1000);
      })
      .catch((e) => vigente && setError(mensajeErrorSalud(e)));
    return () => {
      vigente = false;
    };
  }, [intento]);

  useEffect(() => {
    let vigente = true;
    obtenerEstadoColector().then((e) => vigente && setEstadoColector(e));
    // Sin la migración de zonas aún aplicada, simplemente no hay días detectados.
    obtenerZonas()
      .then((z) => vigente && setZonas(z))
      .catch(() => vigente && setZonas([]));
    return () => {
      vigente = false;
    };
  }, [intento]);

  useEffect(() => {
    let vigente = true;
    obtenerViajes()
      .then((v) => {
        if (!vigente) return;
        setViajes(v);
        setErrorViajes(null);
      })
      .catch((e) => vigente && setErrorViajes(`No se pudieron leer los viajes: ${mensajeErrorSalud(e)}`));
    return () => {
      vigente = false;
    };
  }, [intentoViajes]);

  const estres = useMemo(() => (dias ? estresDiurno(dias) : []), [dias]);
  const zonasDia = useMemo(() => zonaPorDia(zonas), [zonas]);
  const diasViaje = useMemo(() => fechasDeViaje(viajes ?? [], hoy), [viajes, hoy]);

  const enPeriodo = useMemo(() => (dias ? ultimosDias(dias, periodo) : []), [dias, periodo]);
  const conNoche = useMemo(() => (dias ?? []).filter((d) => d.noche), [dias]);
  const nocheLigera = conNoche.find((d) => d.fecha === noche) ?? conNoche.at(-1);
  const fechaLigera = nocheLigera?.ligero ? nocheLigera.fecha : null;
  useEffect(() => {
    if (!fechaLigera || fechaLigera in completas) return;
    let vigente = true;
    obtenerDiaCompleto(fechaLigera)
      .then((d) => vigente && setCompletas((c) => ({ ...c, [fechaLigera]: d })))
      .catch(() => vigente && setCompletas((c) => ({ ...c, [fechaLigera]: null })));
    return () => {
      vigente = false;
    };
  }, [fechaLigera, completas]);
  const nocheElegida = (fechaLigera && completas[fechaLigera]) || nocheLigera;
  const cargandoDetalle = !!fechaLigera && !(fechaLigera in completas);

  return (
    <MarcoEspacio
      titulo="Salud"
      onIrAInicio={onIrAInicio}
      acciones={
        ultimaSubida && (
          // También en teléfonos (auditoría A4): es la única pista de que la
          // laptop dejó de subir. Sin franja de aviso: solo ⚠ si pasan 6 h.
          <span
            className="text-xs"
            style={{ color: subidaVieja ? "var(--text-primary)" : "var(--text-muted)" }}
            title={subidaVieja ? "La laptop lleva más de 6 h sin subir datos del anillo." : undefined}
          >
            {subidaVieja && "⚠ "}
            <span className="hidden sm:inline">Última subida: </span>
            {new Date(ultimaSubida).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )
      }
    >
        <AvisoColector estado={estadoColector} />
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
            <div className="sin-barra -mx-1 overflow-x-auto whitespace-nowrap px-1">
              <Segmentado opciones={PESTANAS} valor={pestana} onCambiar={cambiarPestana} />
            </div>

            {pestana !== "hoy" && pestana !== "sueno-noche" && pestana !== "semana" && pestana !== "relaciones" && pestana !== "viajes" && (
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
            )}

            {pestana === "hoy" && (
              <>
                <AvisoResumenListo hoy={hoy} onVer={() => cambiarPestana("semana")} />
                <Panel titulo="Tus puntuaciones de hoy" nota="De 0 a 100, calculadas con tus datos del anillo y tus líneas base (no son las de Oura).">
                  <PuntuacionesHoy dias={dias} hoy={hoy} />
                </Panel>
                <Panel titulo="Tus puntuaciones de los últimos 30 días">
                  <HistorialPuntuaciones dias={dias} />
                </Panel>
                <TarjetasHoy dias={dias} />
                <Panel titulo="Batería del anillo">
                  <TarjetaBateria ultima={bateria} />
                </Panel>
              </>
            )}

            {pestana === "semana" && (
              <Panel titulo="Resumen semanal: sueño, recuperación y estrés" nota="Cada domingo se cierra la semana (lunes a domingo) y se compara contra la anterior.">
                <ResumenSemanal dias={dias} estres={estres} hoy={hoy} />
              </Panel>
            )}

            {pestana === "relaciones" && <RelacionesSalud dias={dias} estres={estres} diasViaje={diasViaje} />}

            {pestana === "viajes" && (
              <Panel titulo="Vista de viaje" nota="Marca tus viajes para ver cómo te afectan el cambio de horario y el viaje: antes, durante y al regresar.">
                <VistaViajes
                  dias={dias}
                  estres={estres}
                  viajes={viajes}
                  zonas={zonasDia}
                  hoy={hoy}
                  error={errorViajes}
                  onCambio={() => setIntentoViajes((n) => n + 1)}
                />
              </Panel>
            )}

            {pestana === "sueno-noche" && (
              <>
                <Panel titulo="Calendario de sueño" nota="Toca un día para ver su noche abajo.">
                  <CalendarioSueno dias={dias} seleccion={nocheElegida?.fecha ?? null} onSeleccionar={setNoche} />
                </Panel>
                <Panel
                  titulo={`Fases de sueño · noche que terminó el ${nocheElegida ? nocheElegida.fecha.split("-").reverse().join("/") : "—"}`}
                  nota="Fases calculadas por open_health a partir de las señales del anillo."
                >
                  {cargandoDetalle ? (
                    <Vacio>Cargando el detalle de esa noche…</Vacio>
                  ) : (
                    <Hipnograma dia={nocheElegida} />
                  )}
                </Panel>
                <Panel titulo="Sueño de ese día en bloques (noche y siestas)">
                  <BloquesSueno dia={nocheElegida} />
                </Panel>
                <Panel titulo="Ritmo cardiaco y HRV durante esa noche">
                  {cargandoDetalle ? <Vacio>Cargando el detalle de esa noche…</Vacio> : <SenalesNoche dia={nocheElegida} />}
                </Panel>
              </>
            )}

            {pestana === "sueno" && (
              <>
                <Panel titulo="Sueño por noche (meta 8 h) y deuda acumulada">
                  <FasesPorNoche dias={enPeriodo} />
                </Panel>
                <Panel titulo="Horario de sueño (hora de dormir → despertar)">
                  <ConstanciaHorario dias={enPeriodo} />
                  <div className="mt-2">
                    <HorarioSueno dias={enPeriodo} />
                  </div>
                </Panel>
              </>
            )}

            {pestana === "corazon" && (
              <>
                <Panel titulo="Estrés durante el día">
                  <EstresDelDia dias={dias} estres={estres} />
                </Panel>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Panel titulo="HRV por noche (ms)">
                    <Tendencia dias={enPeriodo} leer={leerHRV} color="var(--series-1)" unidad="ms" vacio="Aún no hay HRV nocturna." />
                  </Panel>
                  <Panel titulo="HR en reposo por noche (lpm)">
                    <Tendencia dias={enPeriodo} leer={leerRHR} color="var(--series-2)" unidad="lpm" vacio="Aún no hay HR en reposo." />
                  </Panel>
                </div>
                <Panel titulo="Ritmo cardiaco a lo largo del día" nota="Incluye las lecturas de día (HR diurno) y de noche.">
                  <HRDelDia dias={enPeriodo} />
                </Panel>
              </>
            )}

            {pestana === "temperatura" && (
              <>
                <Panel titulo="Temperatura de la piel vs. tu línea base (°C)">
                  <Temperatura dias={enPeriodo} />
                </Panel>
                <Panel titulo="Temperatura de la piel a lo largo del día">
                  <TemperaturaDelDia dias={dias} />
                </Panel>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Panel titulo="Oxígeno en sangre (SpO2) por noche (%)" nota="Normal: 95–100%. Bajadas repetidas de noche pueden indicar pausas al respirar.">
                    <Tendencia dias={enPeriodo} leer={leerSpO2} color="var(--series-1)" unidad="%" vacio="Aún no hay SpO2 nocturno." />
                  </Panel>
                  <Panel titulo="Respiración por noche (resp/min)" nota="Suele subir uno o dos días antes de enfermarte.">
                    <Tendencia dias={enPeriodo} leer={leerRespiracion} color="var(--series-2)" unidad="resp/min" vacio="Aún no hay frecuencia respiratoria." decimales={1} />
                  </Panel>
                </div>
              </>
            )}

            {pestana === "actividad" && (
              <>
                <Panel
                  titulo="Sesiones de ejercicio"
                  nota="Detectadas por el colector: 10 min o más seguidos con 3 MET o más (caminar rápido cuenta como moderado). El tipo es una sugerencia hasta que lo confirmas; la FC puede faltar si el anillo no leyó buenos latidos en movimiento."
                >
                  <EjercicioSalud dias={enPeriodo} historia={dias ?? undefined} />
                </Panel>
                <Panel titulo="Actividad por día" nota="Pasos y calorías los calcula open_health con el movimiento del anillo.">
                  <ActividadDiaria dias={enPeriodo} />
                </Panel>
              </>
            )}
          </>
        )}
    </MarcoEspacio>
  );
}
