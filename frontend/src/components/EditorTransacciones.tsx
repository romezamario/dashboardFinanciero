import { useMemo, useState } from "react";
import { actualizarCategoriaYComercio, buscarPorDescripcion } from "../lib/queries";
import type { Transaccion } from "../lib/types";

const formateadorMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const formateadorFecha = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const TOPE_RESULTADOS = 100;

interface EditorTransaccionesProps {
  transacciones: Transaccion[];
  onActualizado: () => void | Promise<void>;
}

export function EditorTransacciones({
  transacciones,
  onActualizado,
}: EditorTransaccionesProps) {
  const [busqueda, setBusqueda] = useState("");
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [nuevoComercio, setNuevoComercio] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(
    null
  );

  // Todas las transacciones que coinciden con la búsqueda -- se acota la
  // tabla a un tope para no renderizar cientos de filas, pero "Seleccionar
  // todo" opera sobre TODAS las coincidencias, no solo las visibles, para
  // que buscar un patrón amplio (ej. "TELEVIA") de verdad sirva para
  // editar todas sus transacciones de un golpe.
  const coincidencias = useMemo(
    () => buscarPorDescripcion(transacciones, busqueda),
    [transacciones, busqueda]
  );
  const visibles = coincidencias.slice(0, TOPE_RESULTADOS);

  const categoriasExistentes = useMemo(
    () =>
      Array.from(
        new Set(
          transacciones.map((t) => t.categorias?.nombre).filter((n): n is string => !!n)
        )
      ).sort(),
    [transacciones]
  );
  const comerciosExistentes = useMemo(
    () =>
      Array.from(
        new Set(transacciones.map((t) => t.comercio).filter((c): c is string => !!c))
      ).sort(),
    [transacciones]
  );

  function alternarSeleccion(id: string) {
    setSeleccionadas((anterior) => {
      const nueva = new Set(anterior);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  function seleccionarTodasLasCoincidencias() {
    setSeleccionadas(new Set(coincidencias.map((t) => t.id)));
  }

  function limpiarSeleccion() {
    setSeleccionadas(new Set());
  }

  async function aplicarCambios() {
    const categoria = nuevaCategoria.trim();
    const comercio = nuevoComercio.trim();
    if (seleccionadas.size === 0 || (!categoria && !comercio)) return;

    setGuardando(true);
    setMensaje(null);
    try {
      await actualizarCategoriaYComercio(Array.from(seleccionadas), {
        categoria: categoria || undefined,
        comercio: comercio || undefined,
      });
      setMensaje({
        tipo: "ok",
        texto: `Se actualizaron ${seleccionadas.size} transacción(es).`,
      });
      setSeleccionadas(new Set());
      setNuevaCategoria("");
      setNuevoComercio("");
      await onActualizado();
    } catch (e) {
      setMensaje({
        tipo: "error",
        texto: e instanceof Error ? e.message : "No se pudo actualizar.",
      });
    } finally {
      setGuardando(false);
    }
  }

  const puedeAplicar =
    seleccionadas.size > 0 && (nuevaCategoria.trim() || nuevoComercio.trim()) && !guardando;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Editar categoría/comercio en lote
      </h3>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Busca por descripción, selecciona una o varias transacciones, y asígnales una
        categoría y/o comercio nuevos.
      </p>

      <input
        type="text"
        value={busqueda}
        onChange={(e) => {
          setBusqueda(e.target.value);
          setSeleccionadas(new Set());
        }}
        placeholder="Buscar en la descripción, ej. TELEVIA"
        className="mt-3 w-full rounded-md px-3 py-2 text-sm"
        style={{
          background: "var(--page-plane)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
        }}
      />

      {busqueda.trim() && (
        <>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {coincidencias.length} coincidencia(s)
              {coincidencias.length > TOPE_RESULTADOS &&
                ` (mostrando las primeras ${TOPE_RESULTADOS})`}
            </span>
            <div className="flex gap-3">
              <button
                onClick={seleccionarTodasLasCoincidencias}
                disabled={coincidencias.length === 0}
                className="text-xs underline disabled:opacity-50"
                style={{ color: "var(--series-1)" }}
              >
                Seleccionar todas las coincidencias
              </button>
              <button
                onClick={limpiarSeleccion}
                disabled={seleccionadas.size === 0}
                className="text-xs underline disabled:opacity-50"
                style={{ color: "var(--text-muted)" }}
              >
                Limpiar selección
              </button>
            </div>
          </div>

          <div className="mt-2 max-h-64 overflow-auto rounded-md" style={{ border: "1px solid var(--border)" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {visibles.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => alternarSeleccion(t.id)}
                    className="cursor-pointer"
                    style={{ borderBottom: "1px solid var(--gridline)" }}
                  >
                    <td className="w-8 py-2 pl-2">
                      <input
                        type="checkbox"
                        checked={seleccionadas.has(t.id)}
                        onChange={() => alternarSeleccion(t.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="py-2 pr-2" style={{ color: "var(--text-secondary)" }}>
                      {formateadorFecha.format(new Date(t.fecha + "T00:00:00"))}
                    </td>
                    <td className="py-2 pr-2" style={{ color: "var(--text-primary)" }}>
                      {t.descripcion}
                    </td>
                    <td className="py-2 pr-2" style={{ color: "var(--text-secondary)" }}>
                      {t.categorias?.nombre ?? "—"}
                    </td>
                    <td className="py-2 pr-2" style={{ color: "var(--text-secondary)" }}>
                      {t.comercio ?? "—"}
                    </td>
                    <td className="py-2 pr-2" style={{ color: "var(--text-secondary)" }}>
                      {t.tarjeta ?? "—"}
                    </td>
                    <td
                      className="py-2 pr-2 text-right"
                      style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {formateadorMoneda.format(t.monto)}
                    </td>
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-4 text-center text-sm"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Sin coincidencias.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Nueva categoría
              <input
                type="text"
                list="editor-categorias-existentes"
                value={nuevaCategoria}
                onChange={(e) => setNuevaCategoria(e.target.value)}
                placeholder="(sin cambio)"
                className="mt-1 block w-48 rounded-md px-3 py-2 text-sm"
                style={{
                  background: "var(--page-plane)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              />
              <datalist id="editor-categorias-existentes">
                {categoriasExistentes.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>

            <label className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Nuevo comercio
              <input
                type="text"
                list="editor-comercios-existentes"
                value={nuevoComercio}
                onChange={(e) => setNuevoComercio(e.target.value)}
                placeholder="(sin cambio)"
                className="mt-1 block w-48 rounded-md px-3 py-2 text-sm"
                style={{
                  background: "var(--page-plane)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              />
              <datalist id="editor-comercios-existentes">
                {comerciosExistentes.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>

            <button
              onClick={aplicarCambios}
              disabled={!puedeAplicar}
              className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--series-1)" }}
            >
              {guardando
                ? "Aplicando..."
                : `Aplicar a ${seleccionadas.size} seleccionada(s)`}
            </button>
          </div>

          {mensaje && (
            <p
              className="mt-2 text-sm"
              style={{
                color:
                  mensaje.tipo === "ok" ? "var(--status-good)" : "var(--status-critical)",
              }}
            >
              {mensaje.texto}
            </p>
          )}
        </>
      )}
    </div>
  );
}
