// Panel de un día en "Gastos recientes → Por estado de cuenta": resumen por cuenta,
// detalle, "No suman al total", edición en línea y coincidencia con el aviso de
// correo. Separado de GastosEstadoCuentaTab.tsx, que arma el calendario.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { descargarDiaEstadoExcel } from "../lib/exportarGastosEstadoCuenta";
import type { Coincidencia } from "../lib/conciliarCorreo";
import { tituloDia } from "../lib/gastosCorreo";
import {
  sumarUnoEstado,
  type DiaEstadoCuenta,
  type MovimientoDia,
  type MovimientoSinSumar,
} from "../lib/gastosEstadoCuenta";
import {
  actualizarCategoriaComercioYEvento,
  quitarEventoDeTransacciones,
  SIN_CATEGORIA,
} from "../lib/queries";
import {
  dinero,
  ESTILO_CABECERA,
  ESTILO_SUBTOTAL_CATEGORIA,
  ESTILO_SUBTOTAL_COMERCIO,
  ESTILO_TOTAL,
  formatoMoneda,
  useDescargaExcel,
} from "../lib/gastosUI";
import { AsignarEventoDia } from "./AsignarEventoDia";
import { CoincidenciaFlotante, type EstadoCorreo } from "./CoincidenciaFlotante";
import {
  CabeceraColumnas,
  CeldasSumas,
  SeccionTabla,
} from "./TablasGastosDia";

export interface Sugerencias {
  categorias: string[];
  comercios: string[];
  eventos: string[];
}

/** Lo que las filas necesitan para mostrar/abrir la coincidencia con el correo. */
interface ContextoCoincidencias {
  coincidencias: Map<string, Coincidencia>;
  abrir: (evento: React.MouseEvent, mov: MovimientoDia) => void;
}
const ContextoCoincidencia = createContext<ContextoCoincidencias | null>(null);

export function PanelDiaEstado({
  dia,
  sugerencias,
  onActualizado,
  coincidencias,
  correo,
}: {
  dia: DiaEstadoCuenta;
  sugerencias: Sugerencias;
  onActualizado: (ids?: string[]) => void | Promise<void>;
  coincidencias: Map<string, Coincidencia>;
  correo: EstadoCorreo;
}) {
  const { descargando, errorExcel, descargar } = useDescargaExcel(() =>
    descargarDiaEstadoExcel(dia)
  );
  // Id del movimiento cuyo editor está abierto (uno a la vez) y último aviso.
  const [editando, setEditando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Movimientos marcados para asignarles evento en bloque (ids de `transacciones`).
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  function alternarSeleccion(id: string) {
    setSeleccion((previa) => {
      const nueva = new Set(previa);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }
  async function asignarEvento(ids: string[], evento: string | null) {
    if (evento === null) await quitarEventoDeTransacciones(ids);
    else await actualizarCategoriaComercioYEvento(ids, { evento });
    await onActualizado(ids);
  }
  const movimientosDelDia = [...dia.gastos, ...dia.sinSumar.map((s) => s.mov)];
  // Tarjetita de la posible coincidencia en el correo (junto al clic).
  const [flotante, setFlotante] = useState<{ mov: MovimientoDia; x: number; y: number } | null>(null);
  const cerrarFlotante = useCallback(() => setFlotante(null), []);
  async function heredar(id: string, evento: string) {
    await actualizarCategoriaComercioYEvento([id], { evento });
    await onActualizado([id]);
  }
  const contextoCoincidencia = useMemo<ContextoCoincidencias>(
    () => ({
      coincidencias,
      abrir: (evento, mov) => setFlotante({ mov, x: evento.clientX, y: evento.clientY }),
    }),
    [coincidencias]
  );

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
    <ContextoCoincidencia.Provider value={contextoCoincidencia}>
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
              seleccion={seleccion}
              onAlternar={alternarSeleccion}
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
            seleccion={seleccion}
            onAlternar={alternarSeleccion}
          />
        )}
        <AsignarEventoDia
          idsDelDia={movimientosDelDia.map((m) => m.id)}
          seleccion={seleccion}
          onCambiarSeleccion={setSeleccion}
          conEvento={movimientosDelDia.filter((m) => seleccion.has(m.id) && m.evento).length}
          eventosExistentes={sugerencias.eventos}
          onAsignarEvento={asignarEvento}
          idLista="eventos-estado"
          nota="Los eventos empiezan ocultos: sus cargos dejan de sumar al día hasta que los muestres en «Ocultar categorías y eventos»."
        />
      </div>
      {flotante && (
        <CoincidenciaFlotante
          mov={flotante.mov}
          x={flotante.x}
          y={flotante.y}
          coincidencia={coincidencias.get(flotante.mov.id)}
          correo={correo}
          onHeredar={(evento) => heredar(flotante.mov.id, evento)}
          onCerrar={cerrarFlotante}
        />
      )}
    </section>
    </ContextoCoincidencia.Provider>
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
      onClick={(e) => {
        e.stopPropagation(); // el clic en la fila abre la coincidencia con el correo
        onEditar(id);
      }}
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
  seleccion,
  onAlternar,
}: {
  dia: DiaEstadoCuenta;
  sugerencias: Sugerencias;
  editando: string | null;
  onEditar: (id: string) => void;
  onCancelar: () => void;
  onGuardado: (aviso: string) => void | Promise<void>;
  seleccion: Set<string>;
  onAlternar: (id: string) => void;
}) {
  const vacias = (n: number) => Array.from({ length: n }, (_, i) => <td key={i} />);
  // + casilla + Total + la columna del botón "Editar".
  const columnasTotales = COLUMNAS_TEXTO_DETALLE + dia.cuentas.length + 3;
  return (
    <SeccionTabla titulo="Detalle por transacción">
      <thead>
        <tr style={ESTILO_CABECERA}>
          <th className="w-8 px-3 py-2" />
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
                <CeldaSeleccion mov={g} seleccion={seleccion} onAlternar={onAlternar} />
                <td className="whitespace-nowrap px-3 py-1.5">{g.categoria}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{g.comercio}</td>
                <td className="max-w-64 px-3 py-1.5">
                  <DescripcionMovimiento mov={g} />
                </td>
                <td className="whitespace-nowrap px-3 py-1.5" style={{ color: "var(--text-secondary)" }}>
                  {g.tarjeta ?? ""}
                </td>
                <CeldaEvento mov={g} />
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
              <td />
              <td className="whitespace-nowrap px-3 py-1.5">{fila.categoria}</td>
              <td className="px-3 py-1.5">Subtotal</td>
              {vacias(3)}
              <CeldasSumas sumas={fila.sumas} columnas={dia.cuentas} />
              <td />
            </tr>
          );
        })}
        <tr style={ESTILO_TOTAL}>
          <td />
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
  seleccion,
  onAlternar,
}: {
  sinSumar: MovimientoSinSumar[];
  sugerencias: Sugerencias;
  editando: string | null;
  onEditar: (id: string) => void;
  onCancelar: () => void;
  onGuardado: (aviso: string) => void | Promise<void>;
  seleccion: Set<string>;
  onAlternar: (id: string) => void;
}) {
  return (
    <SeccionTabla
      titulo="No suman al total"
      nota="Abonos (pagos recibidos, ingresos, devoluciones), movimientos de la cuenta de cheques y cargos de categorías ocultas: no cuentan en el total del día ni en el color del calendario."
    >
      <thead>
        <tr style={ESTILO_CABECERA}>
          <th className="w-8 px-3 py-2" />
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
            columnasTotales={8}
            abierta={editando === mov.id}
            mov={mov}
            sugerencias={sugerencias}
            onGuardado={onGuardado}
            onCancelar={onCancelar}
          >
            <CeldaSeleccion mov={mov} seleccion={seleccion} onAlternar={onAlternar} />
            <td className="whitespace-nowrap px-3 py-1.5">{mov.categoria}</td>
            <td className="max-w-64 px-3 py-1.5">
              <DescripcionMovimiento mov={mov} />
            </td>
            <td className="whitespace-nowrap px-3 py-1.5" style={{ color: "var(--text-secondary)" }}>
              {mov.cuenta}
              {mov.tarjeta ? ` · ${mov.tarjeta}` : ""}
            </td>
            <CeldaEvento mov={mov} />
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

/** Casilla para marcar el movimiento (asignación de evento en bloque); su clic no abre la coincidencia del correo. */
function CeldaSeleccion({
  mov,
  seleccion,
  onAlternar,
}: {
  mov: MovimientoDia;
  seleccion: Set<string>;
  onAlternar: (id: string) => void;
}) {
  return (
    <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={seleccion.has(mov.id)}
        onChange={() => onAlternar(mov.id)}
        aria-label={`Seleccionar ${mov.descripcion} para asignarle un evento`}
      />
    </td>
  );
}

/** Evento del movimiento; si no tiene y su aviso de correo sí, lo muestra como pista ("↳ evento"), sin guardarlo. */
function CeldaEvento({ mov }: { mov: MovimientoDia }) {
  const contexto = useContext(ContextoCoincidencia);
  const delCorreo = mov.evento ? null : (contexto?.coincidencias.get(mov.id)?.gasto.evento ?? null);
  return (
    <td className="whitespace-nowrap px-3 py-1.5" style={{ color: "var(--text-secondary)" }}>
      {mov.evento ??
        (delCorreo && (
          <span
            style={{ color: "var(--text-muted)", fontStyle: "italic" }}
            title="El aviso de correo emparejado tiene este evento; aún no se asigna al movimiento (clic en la fila para hacerlo)"
          >
            ↳ {delCorreo}
          </span>
        ))}
    </td>
  );
}

/** La descripción del movimiento -- un botón, para que se pueda abrir con el
 * teclado (su clic sube a la fila, que abre la tarjeta) -- y, si tiene una
 * posible coincidencia en el correo, una marca ✉. */
function DescripcionMovimiento({ mov }: { mov: MovimientoDia }) {
  const contexto = useContext(ContextoCoincidencia);
  const coincide = contexto?.coincidencias.has(mov.id) ?? false;
  return (
    <button type="button" className="flex max-w-full items-center gap-1.5 text-left" title={mov.descripcion}>
      <span className="truncate">{mov.descripcion}</span>
      {coincide && (
        <span
          className="shrink-0"
          style={{ color: "var(--series-1)" }}
          title="Posible coincidencia en el correo"
          aria-label="Tiene una posible coincidencia en el correo"
        >
          ✉
        </span>
      )}
    </button>
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
  const contexto = useContext(ContextoCoincidencia);
  return (
    <>
      <tr
        onClick={contexto ? (e) => contexto.abrir(e, mov) : undefined}
        className="cursor-pointer"
        style={{ borderBottom: "1px solid var(--border)" }}
        title="Clic para ver la posible coincidencia en el correo"
      >
        {children}
      </tr>
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
