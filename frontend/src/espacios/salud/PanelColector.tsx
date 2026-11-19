// Pestaña "Colector" de Salud (Mario, 2026-11-19): ¿la laptop está leyendo el
// anillo? Estado, fallas recientes, corridas por hora y huecos de datos por
// hora. Lógica en lecturas.ts.
import { useEffect, useMemo, useState } from "react";
import { Leyenda, Panel, TarjetaBateria, Vacio } from "./GraficasSalud";
import { AMARILLO_AVISO, fechaCorta } from "./formatoSalud";
import { haceCuanto, mensajeErrorSalud, type DiaSalud, type LecturaBateria } from "./salud";
import { VERSION_COLECTOR_ESPERADA } from "./colector";
import {
  DIAS_CORRIDAS,
  DIAS_DATOS,
  coberturaPuesto,
  desdeCorridas,
  fallasRecientes,
  huecosDeDatos,
  obtenerCorridas,
  rejillaCorridas,
  rejillaDatos,
  resumirLecturas,
  ultimasFechas,
  type CeldaCorrida,
  type CeldaDatos,
  type EstadoGeneral,
  type LecturaCorridas,
  type Resultado,
} from "./lecturas";

const SIN_RELLENO = "transparent";

const CORRIDA: Record<CeldaCorrida, { color: string; texto: string }> = {
  ok: { color: "var(--status-good)", texto: "Lectura buena" },
  conexion_cortada: { color: AMARILLO_AVISO, texto: "Bluetooth cortado" },
  sin_anillo: { color: "color-mix(in srgb, var(--text-muted) 55%, var(--surface-1))", texto: "No encontró el anillo" },
  error: { color: "var(--status-critical)", texto: "Error del colector" },
  sin_corrida: { color: SIN_RELLENO, texto: "La laptop no corrió" },
  futuro: { color: SIN_RELLENO, texto: "" },
};

const DATOS: Record<CeldaDatos, { color: string; texto: string }> = {
  puesto: { color: "var(--series-1)", texto: "Anillo puesto" },
  quitado: { color: "color-mix(in srgb, var(--series-1) 30%, var(--surface-1))", texto: "Midió sin estar puesto" },
  apagado: { color: "var(--status-critical)", texto: "Anillo apagado" },
  sin_datos: { color: SIN_RELLENO, texto: "Sin datos (hueco)" },
  pendiente: { color: "var(--gridline)", texto: "Aún no se lee" },
  sin_info: { color: "var(--page-plane)", texto: "Sin conteo (colector viejo)" },
  futuro: { color: SIN_RELLENO, texto: "" },
};

const NOMBRE_RESULTADO: Record<Resultado, string> = {
  ok: "lectura buena",
  sin_anillo: "no encontró el anillo",
  conexion_cortada: "Bluetooth cortado a media descarga",
  error: "error del colector",
};

const CONTEO_24H: Record<Resultado, string> = {
  ok: "buenas",
  sin_anillo: "sin encontrar el anillo",
  conexion_cortada: "con Bluetooth cortado",
  error: "con error",
};

const ESTADO: Record<EstadoGeneral, { icono: string; etiqueta: string; color: string }> = {
  bien: { icono: "✓", etiqueta: "Leyendo", color: "var(--status-good)" },
  atrasado: { icono: "⚠", etiqueta: "Atrasado", color: AMARILLO_AVISO },
  sin_lecturas: { icono: "✕", etiqueta: "Sin lecturas", color: "var(--status-critical)" },
  sin_datos: { icono: "–", etiqueta: "Sin datos", color: "var(--text-muted)" },
};

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
const diaSemana = (f: string) =>
  new Date(`${f}T12:00:00Z`).toLocaleDateString("es-MX", { weekday: "short", timeZone: "UTC" }).replace(".", "");

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string | null }) {
  return (
    <div className="rounded-md px-3 py-2" style={{ border: "1px solid var(--border)" }}>
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {titulo}
      </div>
      <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        {valor}
      </div>
      {detalle && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {detalle}
        </div>
      )}
    </div>
  );
}

/** Día × hora con una celda por hora. Las celdas vacías llevan borde punteado
 * (hueco) para no depender del color; cada celda dice su estado al pasar encima. */
function Rejilla<C extends string>({
  filas,
  estilo,
  vacias,
}: {
  filas: Map<string, C[]>;
  estilo: Record<C, { color: string; texto: string }>;
  vacias: readonly C[];
}) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-separate text-[10px]" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="font-normal" style={{ color: "var(--text-muted)" }}>
                {h % 6 === 0 ? h : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...filas].reverse().map(([fecha, celdas]) => (
            <tr key={fecha}>
              <th className="whitespace-nowrap pr-1 text-left font-normal" style={{ color: "var(--text-secondary)" }}>
                {diaSemana(fecha)} {fechaCorta(fecha)}
              </th>
              {celdas.map((c, h) => (
                <td
                  key={h}
                  title={estilo[c].texto ? `${fechaCorta(fecha)} ${h}:00 · ${estilo[c].texto}` : undefined}
                  className="h-4 min-w-2 rounded-sm"
                  style={{
                    background: estilo[c].color,
                    border: vacias.includes(c) ? "1px dashed var(--border)" : undefined,
                  }}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PanelColector({ dias, bateria, hoy }: { dias: DiaSalud[]; bateria: LecturaBateria | null | undefined; hoy: string }) {
  const [lectura, setLectura] = useState<LecturaCorridas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    let vigente = true;
    obtenerCorridas(desdeCorridas(hoy))
      .then((l) => {
        if (!vigente) return;
        setLectura(l);
        setAhora(new Date());
        setError(null);
      })
      .catch((e) => vigente && setError(`No se pudo leer la bitácora del colector: ${mensajeErrorSalud(e)}`));
    return () => {
      vigente = false;
    };
  }, [hoy, intento]);

  const corridas = useMemo(() => lectura?.corridas ?? [], [lectura]);
  const resumen = useMemo(() => resumirLecturas(corridas, ahora), [corridas, ahora]);
  const fallas = useMemo(() => fallasRecientes(corridas), [corridas]);
  const rejCorridas = useMemo(() => rejillaCorridas(corridas, ultimasFechas(hoy, DIAS_CORRIDAS), ahora), [corridas, hoy, ahora]);
  const rejDatos = useMemo(() => rejillaDatos(dias, ultimasFechas(hoy, DIAS_DATOS), resumen.datosHasta, ahora), [dias, hoy, resumen.datosHasta, ahora]);
  const huecos = useMemo(() => huecosDeDatos(rejDatos).slice(0, 8), [rejDatos]);
  const cobertura = useMemo(() => coberturaPuesto(rejDatos), [rejDatos]);
  const conConteo = dias.some((d) => d.eventosHoras);

  if (error)
    return (
      <Panel titulo="Estado del colector">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {error}
        </p>
        <button
          onClick={() => setIntento((n) => n + 1)}
          className="mt-3 rounded-full px-3 py-1 text-xs font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--marca)" }}
        >
          Reintentar
        </button>
      </Panel>
    );
  if (!lectura) return <Vacio>Cargando la bitácora del colector…</Vacio>;

  const e = ESTADO[resumen.estado];
  const u = resumen.ultima;
  const c24 = resumen.ultimas24;
  const partes24 = (Object.keys(c24) as Resultado[]).filter((r) => c24[r] > 0).map((r) => `${c24[r]} ${CONTEO_24H[r]}`);
  const version = u?.version ?? null;

  return (
    <>
      <Panel titulo="Estado del colector de la laptop">
        <div className="flex flex-wrap items-start gap-3">
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ background: e.color, color: resumen.estado === "atrasado" ? "#1a1a19" : "#fff" }}
          >
            {e.icono} {e.etiqueta}
          </span>
          <p className="min-w-0 flex-1 text-sm" style={{ color: "var(--text-primary)" }}>
            {resumen.motivo}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Dato
            titulo="Última lectura buena"
            valor={resumen.ultimaOk ? haceCuanto(resumen.ultimaOk.en, ahora) : "Ninguna en estos días"}
            detalle={resumen.ultimaOk && fechaHora(resumen.ultimaOk.en)}
          />
          <Dato
            titulo="Última corrida"
            valor={u ? `${haceCuanto(u.en, ahora)} · ${NOMBRE_RESULTADO[u.resultado]}` : "—"}
            detalle={u && [u.eventosNuevos != null ? `${u.eventosNuevos.toLocaleString("es-MX")} eventos nuevos` : null, u.duracionS != null ? `${Math.round(u.duracionS)} s` : null].filter(Boolean).join(" · ")}
          />
          <Dato
            titulo="Datos del anillo hasta"
            valor={resumen.datosHasta ? haceCuanto(new Date(resumen.datosHasta * 1000).toISOString(), ahora) : "—"}
            detalle={resumen.datosHasta ? fechaHora(new Date(resumen.datosHasta * 1000).toISOString()) : "Lo anota el colector v5"}
          />
          <Dato
            titulo="Versión del colector"
            valor={version ? `v${version}${u?.commit ? ` · ${u.commit.slice(0, 7)}` : ""}` : "v1 o anterior"}
            detalle={
              (version ?? 1) < VERSION_COLECTOR_ESPERADA
                ? `⚠ El dashboard espera la v${VERSION_COLECTOR_ESPERADA}`
                : u?.alDia === false
                  ? `⚠ No pudo actualizarse${u.errorActualizacion ? `: ${u.errorActualizacion}` : ""}`
                  : u?.alDia
                    ? "✓ Al día con el repo"
                    : null
            }
          />
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          Últimas 24 h: {partes24.length ? partes24.join(" · ") : "ninguna corrida"}.
          {!resumen.conBitacora && " Las corridas que fallan se verán aquí cuando la laptop tenga el colector v5 (se actualiza solo en la siguiente lectura)."}
          {lectura.sinBitacora && " Falta aplicar la migración de la bitácora en Supabase."}
        </p>
        <div className="mt-3">
          <TarjetaBateria ultima={bateria} />
        </div>
      </Panel>

      <Panel titulo={`Corridas por hora (${DIAS_CORRIDAS} días)`} nota="La laptop intenta leer el anillo cada hora. Hora de la laptop en ese momento.">
        <Rejilla filas={rejCorridas} estilo={CORRIDA} vacias={["sin_corrida"]} />
        <div className="mt-2">
          <Leyenda
            items={(["ok", "sin_anillo", "conexion_cortada", "error"] as const).map((k) => CORRIDA[k])}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Cuadro punteado: la laptop no corrió el colector esa hora (apagada, dormida o sin sesión).
          </p>
        </div>
      </Panel>

      <Panel titulo="Fallas recientes">
        {fallas.length ? (
          <ul className="space-y-2 text-sm">
            {fallas.map((f) => (
              <li key={f.desde} className="flex flex-wrap items-baseline gap-x-2" style={{ color: "var(--text-primary)" }}>
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CORRIDA[f.resultado].color }} />
                <span className="font-medium">{CORRIDA[f.resultado].texto}</span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {f.veces > 1 ? `${f.veces} veces, ${fechaHora(f.desde)} – ${hora(f.hasta)}` : fechaHora(f.desde)}
                </span>
                {f.mensaje && f.resultado === "error" && (
                  <span className="basis-full text-xs" style={{ color: "var(--text-secondary)" }}>
                    {f.mensaje}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Vacio>{resumen.conBitacora ? "Ninguna falla en estos días." : "Aún no hay fallas anotadas (llegan con el colector v5)."}</Vacio>
        )}
      </Panel>

      <Panel
        titulo={`Datos del anillo por hora (${DIAS_DATOS} días)`}
        nota={
          cobertura.total
            ? `Anillo puesto ${cobertura.puesto} de ${cobertura.total} h (${Math.round((100 * cobertura.puesto) / cobertura.total)} %). Hora del lugar donde estabas ese día.`
            : "Hora del lugar donde estabas ese día."
        }
      >
        {!conConteo && (
          <p className="mb-1 text-xs" style={{ color: "var(--text-muted)" }}>
            El conteo por hora llega con el colector v5; mientras, solo se ven las horas con temperatura de piel y los apagones.
          </p>
        )}
        <Rejilla filas={rejDatos} estilo={DATOS} vacias={["sin_datos"]} />
        <div className="mt-2">
          <Leyenda items={(["puesto", "quitado", "apagado", "pendiente", "sin_info"] as const).map((k) => DATOS[k])} />
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Cuadro punteado: hueco, el anillo no guardó nada esa hora.
          </p>
        </div>
        {huecos.length > 0 && (
          <>
            <h4 className="mt-4 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Huecos de 2 h o más
            </h4>
            <ul className="mt-1 space-y-1 text-sm" style={{ color: "var(--text-primary)" }}>
              {huecos.map((h) => (
                <li key={`${h.fecha}-${h.hora}`}>
                  {diaSemana(h.fecha)} {fechaCorta(h.fecha)} desde las {h.hora}:00 · {h.horas} h ·{" "}
                  <span style={{ color: "var(--text-secondary)" }}>{h.tipo === "apagado" ? "anillo apagado (sin batería)" : "sin datos"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </>
  );
}
