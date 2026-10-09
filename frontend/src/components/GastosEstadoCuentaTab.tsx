import { useMemo, useState } from "react";
import { descargarDiaEstadoExcel } from "../lib/exportarGastosEstadoCuenta";
import { tituloDia } from "../lib/gastosCorreo";
import { hoyIso } from "../lib/metaDiaria";
import {
  agruparEstadosPorDia,
  diasEntre,
  nombreCorto,
  sumarUnoEstado,
  ultimaFechaPorCuenta,
  type DiaEstadoCuenta,
  type MovimientoDia,
  type MovimientoSinSumar,
} from "../lib/gastosEstadoCuenta";
import {
  actualizarCategoriaComercioYEvento,
  categoriaDe,
  eventoDe,
  quitarEventoDeTransacciones,
  SIN_CATEGORIA,
} from "../lib/queries";
import type { Transaccion } from "../lib/types";
import { type VistaCalendario, dinero, formatoMoneda, useDescargaExcel, ESTILO_CABECERA, ESTILO_SUBTOTAL_CATEGORIA, ESTILO_SUBTOTAL_COMERCIO, ESTILO_TOTAL } from "../lib/gastosUI";
import { CalendarioMensual, type ResumenDia } from "./CalendarioMensual";
import { EnlaceTexto, Fila, PildoraExclusion } from "./PanelFiltros";
import {
  CabeceraColumnas,
  CeldasSumas,
  SeccionTabla,
} from "./TablasGastosDia";

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

interface Sugerencias {
  categorias: string[];
  comercios: string[];
  eventos: string[];
}

interface GastosEstadoCuentaTabProps {
  transacciones: Transaccion[];
  categoriasOcultas: Set<string>;
  onCambiarCategoriasOcultas: (cambio: (anteriores: Set<string>) => Set<string>) => void;
  eventosOcultos: Set<string>;
  onCambiarEventosOcultos: (cambio: (anteriores: Set<string>) => Set<string>) => void;
  onActualizado: (ids?: string[]) => void | Promise<void>;
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
  vista,
  onCambiarVista,
}: GastosEstadoCuentaTabProps) {
  const [verOcultas, setVerOcultas] = useState(false);

  const dias = useMemo(
    () => agruparEstadosPorDia(transacciones, categoriasOcultas, eventosOcultos),
    [transacciones, categoriasOcultas, eventosOcultos]
  );
  const porFecha = useMemo(() => new Map(dias.map((d) => [d.fecha, d])), [dias]);
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
  const ocultasOrdenadas = [
    ...categorias.filter((c) => categoriasOcultas.has(c)),
    ...eventos.filter((e) => eventosOcultos.has(e)),
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

      <div
        className="flex flex-col gap-2 rounded-lg p-3"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
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
            {ocultasOrdenadas.length === 0 ? "· ninguna" : `· ${ocultasOrdenadas.join(", ")}`}
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
              propias cuentas, y ningún evento. Es independiente de las mismas opciones del Resumen.
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
            <PanelDiaEstado dia={dia} sugerencias={sugerencias} onActualizado={onActualizado} />
          ) : null;
        }}
      />
    </div>
  );
}

function PanelDiaEstado({
  dia,
  sugerencias,
  onActualizado,
}: {
  dia: DiaEstadoCuenta;
  sugerencias: Sugerencias;
  onActualizado: (ids?: string[]) => void | Promise<void>;
}) {
  const { descargando, errorExcel, descargar } = useDescargaExcel(() =>
    descargarDiaEstadoExcel(dia)
  );
  // Id del movimiento cuyo editor está abierto (uno a la vez) y último aviso.
  const [editando, setEditando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function abrirEditor(id: string) {
    setAviso(null);
    setEditando(id);
  }

  async function guardado(texto: string) {
    const id = editando;
    setEditando(null);
    setAviso(texto);
    await onActualizado(id ? [id] : undefined);
  }

  return (
    <section
      className="rounded-md"
      style={{ background: "var(--surface-1)", border: "1px solid var(--series-1)" }}
    >
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {tituloDia(dia.fecha)}
        </h3>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {dia.gastos.length} {dia.gastos.length === 1 ? "movimiento" : "movimientos"} ·{" "}
          {dia.cuentas.length} {dia.cuentas.length === 1 ? "cuenta" : "cuentas"}
          {dia.sinSumar.length > 0 && ` · ${dia.sinSumar.length} sin sumar`}
        </span>
        <span
          className="ml-auto text-sm font-semibold tabular-nums"
          style={{ color: "var(--text-primary)" }}
        >
          {formatoMoneda.format(dia.total.total / 100)}
        </span>
        <button
          onClick={descargar}
          disabled={descargando}
          className="rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
          title={`Descarga estado-de-cuenta-${dia.fecha}.xlsx con el resumen, el detalle y todos los movimientos de este día`}
        >
          {descargando ? "Generando…" : "Descargar Excel"}
        </button>
      </header>
      {errorExcel && (
        <p className="px-4 pb-2 text-xs" style={{ color: "var(--status-critical)" }}>
          No se pudo generar el Excel: {errorExcel}
        </p>
      )}
      {aviso && (
        <p className="px-4 pb-2 text-xs" style={{ color: "var(--status-good)" }} role="status">
          {aviso}
        </p>
      )}
      <div className="space-y-5 px-4 pb-4 pt-1">
        {dia.gastos.length > 0 ? (
          <>
            <TablaResumenEstado dia={dia} />
            <TablaDetalleEstado
              dia={dia}
              sugerencias={sugerencias}
              editando={editando}
              onEditar={abrirEditor}
              onCancelar={() => setEditando(null)}
              onGuardado={guardado}
            />
          </>
        ) : (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Ningún movimiento de este día suma al gasto.
          </p>
        )}
        {dia.sinSumar.length > 0 && (
          <TablaSinSumar
            sinSumar={dia.sinSumar}
            sugerencias={sugerencias}
            editando={editando}
            onEditar={abrirEditor}
            onCancelar={() => setEditando(null)}
            onGuardado={guardado}
          />
        )}
      </div>
    </section>
  );
}

const nombreColumna = (c: string) => c;

function TablaResumenEstado({ dia }: { dia: DiaEstadoCuenta }) {
  return (
    <SeccionTabla titulo="Resumen por categoría y cuenta">
      <thead>
        <tr style={ESTILO_CABECERA}>
          <th className="px-3 py-2 text-left font-semibold">Categoría</th>
          <CabeceraColumnas columnas={dia.cuentas} nombre={nombreColumna} />
        </tr>
      </thead>
      <tbody>
        {dia.resumen.map((fila) => (
          <tr key={fila.categoria} style={{ borderBottom: "1px solid var(--border)" }}>
            <td className="whitespace-nowrap px-3 py-1.5">{fila.categoria}</td>
            <CeldasSumas sumas={fila.sumas} columnas={dia.cuentas} />
          </tr>
        ))}
        <tr style={ESTILO_TOTAL}>
          <td className="px-3 py-1.5">Total</td>
          <CeldasSumas sumas={dia.total} columnas={dia.cuentas} />
        </tr>
      </tbody>
    </SeccionTabla>
  );
}

// Categoría, Comercio, Descripción, Tarjeta y Evento (antes de las columnas de cuentas).
const COLUMNAS_TEXTO_DETALLE = 5;

function BotonEditar({ id, onEditar }: { id: string; onEditar: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onEditar(id)}
      className="text-xs underline"
      style={{ color: "var(--series-1)" }}
      title="Cambiar la categoría, el comercio o el evento de este movimiento"
    >
      Editar
    </button>
  );
}

function TablaDetalleEstado({
  dia,
  sugerencias,
  editando,
  onEditar,
  onCancelar,
  onGuardado,
}: {
  dia: DiaEstadoCuenta;
  sugerencias: Sugerencias;
  editando: string | null;
  onEditar: (id: string) => void;
  onCancelar: () => void;
  onGuardado: (aviso: string) => void | Promise<void>;
}) {
  const vacias = (n: number) => Array.from({ length: n }, (_, i) => <td key={i} />);
  // + Total + la columna del botón "Editar".
  const columnasTotales = COLUMNAS_TEXTO_DETALLE + dia.cuentas.length + 2;
  return (
    <SeccionTabla titulo="Detalle por transacción">
      <thead>
        <tr style={ESTILO_CABECERA}>
          <th className="px-3 py-2 text-left font-semibold">Categoría</th>
          <th className="px-3 py-2 text-left font-semibold">Comercio</th>
          <th className="px-3 py-2 text-left font-semibold">Descripción</th>
          <th className="px-3 py-2 text-left font-semibold">Tarjeta</th>
          <th className="px-3 py-2 text-left font-semibold">Evento</th>
          <CabeceraColumnas columnas={dia.cuentas} nombre={nombreColumna} />
          <th />
        </tr>
      </thead>
      <tbody>
        {dia.detalle.map((fila, i) => {
          if (fila.tipo === "gasto") {
            const g = fila.gasto;
            return (
              <FilaMovimiento
                key={g.id}
                columnasTotales={columnasTotales}
                abierta={editando === g.id}
                mov={g}
                sugerencias={sugerencias}
                onGuardado={onGuardado}
                onCancelar={onCancelar}
              >
                <td className="whitespace-nowrap px-3 py-1.5">{g.categoria}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{g.comercio}</td>
                <td className="max-w-64 truncate px-3 py-1.5" title={g.descripcion}>
                  {g.descripcion}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5" style={{ color: "var(--text-secondary)" }}>
                  {g.tarjeta ?? ""}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5" style={{ color: "var(--text-secondary)" }}>
                  {g.evento ?? ""}
                </td>
                <CeldasSumas sumas={sumarUnoEstado(g, dia.cuentas)} columnas={dia.cuentas} />
                <td className="px-3 py-1.5 text-right">
                  <BotonEditar id={g.id} onEditar={onEditar} />
                </td>
              </FilaMovimiento>
            );
          }
          if (fila.tipo === "comercio") {
            return (
              <tr key={`c-${i}`} style={ESTILO_SUBTOTAL_COMERCIO}>
                <td />
                <td className="whitespace-nowrap px-3 py-1.5">Subtotal {fila.comercio}</td>
                {vacias(3)}
                <CeldasSumas sumas={fila.sumas} columnas={dia.cuentas} />
                <td />
              </tr>
            );
          }
          return (
            <tr key={`k-${i}`} style={ESTILO_SUBTOTAL_CATEGORIA}>
              <td className="whitespace-nowrap px-3 py-1.5">{fila.categoria}</td>
              <td className="px-3 py-1.5">Subtotal</td>
              {vacias(3)}
              <CeldasSumas sumas={fila.sumas} columnas={dia.cuentas} />
              <td />
            </tr>
          );
        })}
        <tr style={ESTILO_TOTAL}>
          <td className="px-3 py-1.5">Total</td>
          {vacias(4)}
          <CeldasSumas sumas={dia.total} columnas={dia.cuentas} />
          <td />
        </tr>
      </tbody>
    </SeccionTabla>
  );
}

function TablaSinSumar({
  sinSumar,
  sugerencias,
  editando,
  onEditar,
  onCancelar,
  onGuardado,
}: {
  sinSumar: MovimientoSinSumar[];
  sugerencias: Sugerencias;
  editando: string | null;
  onEditar: (id: string) => void;
  onCancelar: () => void;
  onGuardado: (aviso: string) => void | Promise<void>;
}) {
  return (
    <SeccionTabla
      titulo="No suman al total"
      nota="Abonos (pagos recibidos, ingresos, devoluciones), movimientos de la cuenta de cheques y cargos de categorías ocultas: no cuentan en el total del día ni en el color del calendario."
    >
      <thead>
        <tr style={ESTILO_CABECERA}>
          <th className="px-3 py-2 text-left font-semibold">Categoría</th>
          <th className="px-3 py-2 text-left font-semibold">Descripción</th>
          <th className="px-3 py-2 text-left font-semibold">Cuenta</th>
          <th className="px-3 py-2 text-left font-semibold">Evento</th>
          <th className="px-3 py-2 text-left font-semibold">Por qué no suma</th>
          <th className="px-3 py-2 text-right font-semibold">Monto</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {sinSumar.map(({ mov, motivo }) => (
          <FilaMovimiento
            key={mov.id}
            columnasTotales={7}
            abierta={editando === mov.id}
            mov={mov}
            sugerencias={sugerencias}
            onGuardado={onGuardado}
            onCancelar={onCancelar}
          >
            <td className="whitespace-nowrap px-3 py-1.5">{mov.categoria}</td>
            <td className="max-w-64 truncate px-3 py-1.5" title={mov.descripcion}>
              {mov.descripcion}
            </td>
            <td className="whitespace-nowrap px-3 py-1.5" style={{ color: "var(--text-secondary)" }}>
              {mov.cuenta}
              {mov.tarjeta ? ` · ${mov.tarjeta}` : ""}
            </td>
            <td className="whitespace-nowrap px-3 py-1.5" style={{ color: "var(--text-secondary)" }}>
              {mov.evento ?? ""}
            </td>
            <td className="whitespace-nowrap px-3 py-1.5" style={{ color: "var(--text-secondary)" }}>
              {motivo}
            </td>
            <td
              className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums"
              style={mov.tipo === "abono" ? { color: "var(--status-good)" } : undefined}
            >
              {mov.tipo === "abono" ? "+" : ""}
              {dinero(mov.centavos)}
            </td>
            <td className="px-3 py-1.5 text-right">
              <BotonEditar id={mov.id} onEditar={onEditar} />
            </td>
          </FilaMovimiento>
        ))}
      </tbody>
    </SeccionTabla>
  );
}

/** Una fila de movimiento y, justo debajo cuando está abierta, su editor. */
function FilaMovimiento({
  mov,
  abierta,
  columnasTotales,
  sugerencias,
  onGuardado,
  onCancelar,
  children,
}: {
  mov: MovimientoDia;
  abierta: boolean;
  columnasTotales: number;
  sugerencias: Sugerencias;
  onGuardado: (aviso: string) => void | Promise<void>;
  onCancelar: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr style={{ borderBottom: "1px solid var(--border)" }}>{children}</tr>
      {abierta && (
        <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--page-plane)" }}>
          <td colSpan={columnasTotales} className="px-3 py-3">
            <EditorMovimiento
              mov={mov}
              sugerencias={sugerencias}
              onGuardado={onGuardado}
              onCancelar={onCancelar}
            />
          </td>
        </tr>
      )}
    </>
  );
}

const ESTILO_CAMPO = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
} as const;

/**
 * Corrige un movimiento desde el detalle del día: categoría, comercio y/o
 * evento (mismas funciones que el editor en lote). Un campo vacío = no tocarlo;
 * "Quitar evento" lo vacía. Es un cambio en el tablero: si se vuelve a procesar
 * y sincronizar el PDF, la regla de categorización decide otra vez (para algo
 * permanente, edita la regla).
 */
function EditorMovimiento({
  mov,
  sugerencias,
  onGuardado,
  onCancelar,
}: {
  mov: MovimientoDia;
  sugerencias: Sugerencias;
  onGuardado: (aviso: string) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [categoria, setCategoria] = useState(mov.categoria === SIN_CATEGORIA ? "" : mov.categoria);
  const [comercio, setComercio] = useState(mov.comercio);
  const [evento, setEvento] = useState(mov.evento ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cambios: { categoria?: string; comercio?: string; evento?: string } = {};
  if (categoria.trim() && categoria.trim() !== mov.categoria) cambios.categoria = categoria.trim();
  if (comercio.trim() && comercio.trim() !== mov.comercio) cambios.comercio = comercio.trim();
  if (evento.trim() && evento.trim() !== (mov.evento ?? "")) cambios.evento = evento.trim();
  const hayCambios = Object.keys(cambios).length > 0;

  async function ejecutar(accion: () => Promise<void>, aviso: string) {
    setGuardando(true);
    setError(null);
    try {
      await accion();
      await onGuardado(aviso);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar.");
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Editar: <span style={{ color: "var(--text-primary)" }}>{mov.descripcion}</span> (
        {dinero(mov.centavos)})
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Categoría" valor={categoria} onCambiar={setCategoria} lista="ge-categorias" />
        <Campo etiqueta="Comercio" valor={comercio} onCambiar={setComercio} lista="ge-comercios" />
        <Campo etiqueta="Evento" valor={evento} onCambiar={setEvento} lista="ge-eventos" />
        <button
          type="button"
          disabled={!hayCambios || guardando}
          onClick={() =>
            ejecutar(
              () => actualizarCategoriaComercioYEvento([mov.id], cambios),
              `Se actualizó "${mov.descripcion}".`
            )
          }
          className="rounded-md px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          style={{ background: "var(--series-1)" }}
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {mov.evento && (
          <button
            type="button"
            disabled={guardando}
            onClick={() =>
              ejecutar(
                () => quitarEventoDeTransacciones([mov.id]),
                `Se quitó el evento de "${mov.descripcion}".`
              )
            }
            className="rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50"
            style={{
              background: "transparent",
              border: "1px solid var(--status-critical)",
              color: "var(--status-critical)",
            }}
            title="Vacía el evento de este movimiento"
          >
            Quitar evento
          </button>
        )}
        <button
          type="button"
          onClick={onCancelar}
          disabled={guardando}
          className="text-xs underline"
          style={{ color: "var(--text-muted)" }}
        >
          Cancelar
        </button>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Un campo vacío no se modifica. Si vuelves a procesar y sincronizar este PDF, la regla de
        categorización decide otra vez; para algo permanente, edita la regla.
      </p>
      {error && (
        <p className="text-xs" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}
      <datalist id="ge-categorias">
        {sugerencias.categorias.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="ge-comercios">
        {sugerencias.comercios.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="ge-eventos">
        {sugerencias.eventos.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

function Campo({
  etiqueta,
  valor,
  onCambiar,
  lista,
}: {
  etiqueta: string;
  valor: string;
  onCambiar: (valor: string) => void;
  lista: string;
}) {
  return (
    <label className="w-full text-xs sm:w-auto" style={{ color: "var(--text-secondary)" }}>
      {etiqueta}
      <input
        type="text"
        list={lista}
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        className="mt-1 block w-full rounded-md px-3 py-2 text-sm sm:w-48"
        style={ESTILO_CAMPO}
      />
    </label>
  );
}
