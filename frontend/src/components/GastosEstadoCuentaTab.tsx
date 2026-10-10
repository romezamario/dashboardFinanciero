import { useMemo, useState } from "react";
import { conciliarConCorreo, eventosHeredables, primeraFechaCorreo, type Coincidencia } from "../lib/conciliarCorreo";
import type { GastoCorreo } from "../lib/gastosCorreo";
import { hoyIso } from "../lib/fechas";
import {
  agruparEstadosPorDia,
  aMovimiento,
  diasEntre,
  nombreCorto,
  ultimaFechaPorCuenta,
} from "../lib/gastosEstadoCuenta";
import {
  actualizarCategoriaComercioYEvento,
  categoriaDe,
  eventoDe,
  SIN_CATEGORIA,
} from "../lib/queries";
import type { Transaccion } from "../lib/types";
import type { VistaCalendario } from "../lib/gastosUI";
import { CalendarioMensual, type ResumenDia } from "./CalendarioMensual";
import type { EstadoCorreo } from "./CoincidenciaFlotante";
import { EnlaceTexto, Fila, PildoraExclusion } from "./PanelFiltros";
import { PanelDiaEstado, type Sugerencias } from "./PanelDiaEstado";

/** Más de este tiempo sin movimientos nuevos en una cuenta y su aviso se marca:
 * casi siempre es un estado de cuenta que falta cargar. */
const DIAS_ESTADO_ATRASADO = 45;

const formatoFechaCorta = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const fechaCorta = (fecha: string) => formatoFechaCorta.format(new Date(`${fecha}T12:00:00Z`));

interface GastosEstadoCuentaTabProps {
  transacciones: Transaccion[];
  categoriasOcultas: Set<string>;
  onCambiarCategoriasOcultas: (cambio: (anteriores: Set<string>) => Set<string>) => void;
  eventosOcultos: Set<string>;
  onCambiarEventosOcultos: (cambio: (anteriores: Set<string>) => Set<string>) => void;
  onActualizado: (ids?: string[]) => void | Promise<void>;
  /** Avisos de correo (null = cargando) con los que se buscan coincidencias. */
  gastosCorreo: GastoCorreo[] | null;
  errorCorreo: string | null;
  vista: VistaCalendario;
  onCambiarVista: (cambio: (anterior: VistaCalendario) => VistaCalendario) => void;
}

/**
 * Vista "Por estado de cuenta" de "Gastos recientes": el mismo calendario de la
 * vista por correo, pero con lo que traen los PDF (todo el historial, todas las
 * cuentas). Solo los CARGOS suman al día: los abonos (pagos recibidos,
 * ingresos, devoluciones) y los cargos de las categorías ocultas -- por defecto
 * los pagos de tarjeta y traspasos entre tus cuentas -- salen en el detalle del
 * día, pero no suman al total ni al color. Los días con movimientos en una
 * cuenta que no es TDC (p. ej. Priority) llevan su insignia.
 */
export function GastosEstadoCuentaTab({
  transacciones,
  categoriasOcultas,
  onCambiarCategoriasOcultas,
  eventosOcultos,
  onCambiarEventosOcultos,
  onActualizado,
  gastosCorreo,
  errorCorreo,
  vista,
  onCambiarVista,
}: GastosEstadoCuentaTabProps) {
  const [verOcultas, setVerOcultas] = useState(false);

  const dias = useMemo(
    () => agruparEstadosPorDia(transacciones, categoriasOcultas, eventosOcultos),
    [transacciones, categoriasOcultas, eventosOcultos]
  );
  const porFecha = useMemo(() => new Map(dias.map((d) => [d.fecha, d])), [dias]);
  // Posible coincidencia de cada cargo con un aviso de correo (mismo monto, ±1
  // día). Se calcula sobre TODAS las transacciones, no sobre `dias`: ocultar
  // categorías o eventos no debe cambiar qué aviso le toca a cada cargo.
  const movimientos = useMemo(() => transacciones.flatMap((t) => aMovimiento(t) ?? []), [transacciones]);
  const coincidencias = useMemo(
    () => (gastosCorreo ? conciliarConCorreo(movimientos, gastosCorreo) : new Map<string, Coincidencia>()),
    [movimientos, gastosCorreo]
  );
  // Eventos que el correo ya tiene y el cargo emparejado todavía no (evento -> ids).
  const heredables = useMemo(() => eventosHeredables(movimientos, coincidencias), [movimientos, coincidencias]);
  const correo = useMemo<EstadoCorreo>(
    () =>
      errorCorreo
        ? { tipo: "error" }
        : gastosCorreo
          ? { tipo: "listo", primeraFecha: primeraFechaCorreo(gastosCorreo) }
          : { tipo: "cargando" },
    [gastosCorreo, errorCorreo]
  );
  const resumenes = useMemo<ResumenDia[]>(
    () =>
      dias.map((d) => ({
        fecha: d.fecha,
        total: d.total.total,
        movimientos: d.gastos.length,
        fuentes: d.cuentas.length,
        sinSumar: d.sinSumar.length,
        marcas: [
          ...d.cuentasDebito.map((cuenta) => ({
            texto: nombreCorto(cuenta),
            titulo: `Hay movimientos en ${cuenta}`,
            tono: "cuenta" as const,
          })),
          ...(d.hayAbonos
            ? [
                {
                  texto: "Abono",
                  titulo: "Hay abonos o ingresos este día",
                  tono: "abono" as const,
                },
              ]
            : []),
        ],
      })),
    [dias]
  );
  const ultimas = useMemo(() => ultimaFechaPorCuenta(transacciones), [transacciones]);
  const categorias = useMemo(
    () => Array.from(new Set(transacciones.map(categoriaDe))).sort((a, b) => a.localeCompare(b, "es")),
    [transacciones]
  );
  // Eventos que existen (de TODAS las transacciones, para que un evento oculto
  // no desaparezca de su propia lista).
  const eventos = useMemo(
    () =>
      Array.from(
        new Set(transacciones.map(eventoDe).filter((e): e is string => e !== null))
      ).sort((a, b) => a.localeCompare(b, "es")),
    [transacciones]
  );
  const sugerencias = useMemo<Sugerencias>(() => {
    const ordenado = (valores: (string | null)[]) =>
      Array.from(new Set(valores.filter((v): v is string => !!v))).sort((a, b) =>
        a.localeCompare(b, "es")
      );
    return {
      categorias: categorias.filter((c) => c !== SIN_CATEGORIA),
      comercios: ordenado(transacciones.map((t) => t.comercio)),
      eventos: ordenado(transacciones.map(eventoDe)),
    };
  }, [transacciones, categorias]);

  if (dias.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Todavía no hay movimientos de estados de cuenta — usa la app de escritorio para procesar un
        estado de cuenta y sincronizarlo.
      </p>
    );
  }

  const hoy = hoyIso();
  // Los eventos empiezan todos ocultos: en el resumen plegado van como conteo (no como
  // una lista larga de nombres); los nombres se ven al desplegar.
  const categoriasOcultasOrdenadas = categorias.filter((c) => categoriasOcultas.has(c));
  const eventosOcultosCantidad = eventos.filter((e) => eventosOcultos.has(e)).length;
  const resumenOcultas = [
    ...categoriasOcultasOrdenadas,
    ...(eventosOcultosCantidad > 0
      ? [`${eventosOcultosCantidad} ${eventosOcultosCantidad === 1 ? "evento" : "eventos"}`]
      : []),
  ];

  function alternarCategoria(categoria: string) {
    onCambiarCategoriasOcultas((anteriores) => {
      const nuevas = new Set(anteriores);
      if (nuevas.has(categoria)) nuevas.delete(categoria);
      else nuevas.add(categoria);
      return nuevas;
    });
  }

  function alternarEvento(evento: string) {
    onCambiarEventosOcultos((anteriores) => {
      const nuevos = new Set(anteriores);
      if (nuevos.has(evento)) nuevos.delete(evento);
      else nuevos.add(evento);
      return nuevos;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Movimientos de tus estados de cuenta, de todas las cuentas. Elige un día para ver su
        detalle. Solo los <strong>cargos de tus tarjetas</strong> suman al total y al color del día; los abonos,
        la cuenta de cheques (Priority), las categorías y los eventos ocultos se listan aparte. Montos en MXN.
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span className="font-medium">Datos hasta:</span>
        {ultimas.map((u) => {
          const atraso = diasEntre(hoy, u.fecha);
          const atrasada = atraso > DIAS_ESTADO_ATRASADO;
          return (
            <span
              key={u.cuenta}
              title={
                atrasada
                  ? "Hace tiempo que no hay movimientos nuevos: probablemente falta cargar un estado de cuenta."
                  : undefined
              }
              style={atrasada ? { color: "var(--status-critical)" } : undefined}
            >
              {atrasada && <span aria-hidden="true">⚠ </span>}
              {u.cuenta}: {fechaCorta(u.fecha)}
              {atrasada && ` (hace ${atraso} días)`}
            </span>
          );
        })}
      </div>
      <p className="-mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        Los días posteriores a esa fecha salen vacíos porque aún no se carga ese estado de cuenta, no
        porque no hayas gastado.
      </p>

      <HerenciaDeEventos heredables={heredables} onActualizado={onActualizado} />

      <div
        className="flex flex-col gap-2 rounded-lg p-3 tarjeta"
      >
        <button
          type="button"
          onClick={() => setVerOcultas((v) => !v)}
          aria-expanded={verOcultas}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>
            {verOcultas ? "▾" : "▸"}
          </span>
          <span className="font-medium">Ocultar categorías y eventos</span>
          <span style={{ color: "var(--text-muted)" }}>
            {resumenOcultas.length === 0 ? "· ninguna" : `· ${resumenOcultas.join(", ")}`}
          </span>
          <span className="underline" style={{ color: "var(--text-muted)" }}>
            {verOcultas ? "Listo" : "Editar"}
          </span>
        </button>
        {verOcultas && (
          <>
            <Fila etiqueta="Categorías">
              {categorias.map((categoria) => (
                <PildoraExclusion
                  key={categoria}
                  texto={categoria}
                  excluida={categoriasOcultas.has(categoria)}
                  onClick={() => alternarCategoria(categoria)}
                  titulo={
                    categoriasOcultas.has(categoria)
                      ? "Volver a sumarla al gasto del día"
                      : "No sumarla al gasto del día"
                  }
                />
              ))}
              {categoriasOcultas.size > 0 && (
                <EnlaceTexto onClick={() => onCambiarCategoriasOcultas(() => new Set())}>
                  Mostrar todas
                </EnlaceTexto>
              )}
            </Fila>
            {eventos.length > 0 && (
              <Fila etiqueta="Eventos">
                {eventos.map((evento) => (
                  <PildoraExclusion
                    key={evento}
                    texto={evento}
                    excluida={eventosOcultos.has(evento)}
                    onClick={() => alternarEvento(evento)}
                    titulo={
                      eventosOcultos.has(evento)
                        ? "Volver a sumarlo al gasto del día"
                        : "No sumarlo al gasto del día"
                    }
                  />
                ))}
                {eventosOcultos.size > 0 && (
                  <EnlaceTexto onClick={() => onCambiarEventosOcultos(() => new Set())}>
                    Mostrar todos
                  </EnlaceTexto>
                )}
              </Fila>
            )}
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Los cargos de tarjeta de estas categorías o de estos eventos (un viaje, una boda...) no suman
              al total del día ni al color del calendario ni a los promedios, pero siguen apareciendo en
              el detalle del día. Por defecto se ocultan los pagos de tarjeta y traspasos entre tus
              propias cuentas y TODOS los eventos (un evento nuevo también empieza oculto): toca un
              evento para volver a sumarlo. Es independiente de las mismas opciones del Resumen.
            </p>
          </>
        )}
      </div>

      <CalendarioMensual
        dias={resumenes}
        etiquetaFuente={["cuenta", "cuentas"]}
        etiquetaTotal="gasto por día"
        vista={vista}
        onCambiarVista={onCambiarVista}
        // Los estados de cuenta llegan con atraso: el promedio semanal cuenta
        // hasta el último día con movimientos cargados, no hasta hoy.
        fechaCorte={dias[0].fecha}
        renderPanel={(fecha) => {
          const dia = porFecha.get(fecha);
          return dia ? (
            <PanelDiaEstado
              key={dia.fecha}
              dia={dia}
              sugerencias={sugerencias}
              onActualizado={onActualizado}
              coincidencias={coincidencias}
              correo={correo}
            />
          ) : null;
        }}
      />
    </div>
  );
}
/**
 * Cargos sin evento cuyo aviso de correo emparejado sí tiene uno (asignado el mismo día desde
 * "Por correo"). Es una pista (mismo monto, ±1 día), así que nada se asigna solo: se muestra
 * cuántos son y el usuario los hereda de una vez o uno por uno desde la tarjeta del movimiento.
 * Nunca se pisa un evento ya asignado (`eventosHeredables`).
 */
function HerenciaDeEventos({
  heredables,
  onActualizado,
}: {
  heredables: Map<string, string[]>;
  onActualizado: (ids?: string[]) => void | Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const total = Array.from(heredables.values()).reduce((suma, ids) => suma + ids.length, 0);

  async function heredarTodos() {
    setTrabajando(true);
    setMensaje(null);
    const ids: string[] = [];
    try {
      // Un update por evento, todos a la vez (cada uno ya manda sus lotes en
      // paralelo); los que sí se guardaron cuentan aunque otro falle.
      const resultados = await Promise.allSettled(
        Array.from(heredables, ([evento, delEvento]) =>
          actualizarCategoriaComercioYEvento(delEvento, { evento }).then(() => ids.push(...delEvento))
        )
      );
      const fallo = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (fallo) throw fallo.reason;
      setConfirmando(false);
      setMensaje({
        tipo: "ok",
        texto: `Se asignó el evento a ${ids.length} movimiento(s). Los eventos empiezan ocultos: si quieres que sus cargos sumen al día, muéstralos en «Ocultar categorías y eventos».`,
      });
    } catch (e) {
      setMensaje({
        tipo: "error",
        texto: `${e instanceof Error ? e.message : "No se pudo guardar."} ${ids.length > 0 ? `(Ya se asignaron ${ids.length}.)` : ""}`,
      });
    } finally {
      if (ids.length > 0) await onActualizado(ids);
      setTrabajando(false);
    }
  }

  if (total === 0 && !mensaje) return null;
  return (
    <div
      className="space-y-2 rounded-lg p-3 text-xs"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
    >
      {total > 0 && (
        <>
          <p>
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {total} {total === 1 ? "cargo puede" : "cargos pueden"} heredar un evento del correo
            </span>{" "}
            ({Array.from(heredables).map(([evento, ids]) => `${evento}: ${ids.length}`).join(" · ")}). Se
            emparejan por monto y fecha (±1 día), así que revisa; los que ya tienen evento no se tocan.
          </p>
          {confirmando ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>¿Asignar el evento a {total} movimiento(s)?</span>
              <button
                type="button"
                onClick={heredarTodos}
                disabled={trabajando}
                className="rounded-md px-3 py-1.5 font-medium text-white disabled:opacity-50"
                style={{ background: "var(--series-1)" }}
              >
                {trabajando ? "Guardando…" : "Sí, asignar"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                disabled={trabajando}
                className="underline"
                style={{ color: "var(--text-muted)" }}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="rounded-md px-3 py-1.5 font-medium"
              style={{ border: "1px solid var(--series-1)", color: "var(--series-1)" }}
            >
              Heredar eventos
            </button>
          )}
        </>
      )}
      {mensaje && (
        <p
          role="status"
          style={{ color: mensaje.tipo === "ok" ? "var(--status-good)" : "var(--status-critical)" }}
        >
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}
