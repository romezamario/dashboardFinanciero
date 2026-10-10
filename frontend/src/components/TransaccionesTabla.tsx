import { memo, useMemo, useState } from "react";
import type { Transaccion } from "../lib/types";
import { useEsMovil } from "../hooks/useEsMovil";
import { monedaConCentavos as formateadorMoneda, fechaCorta, entero } from "../lib/formato";

/** Filas que se dibujan de entrada (y que agrega cada "Mostrar más"). Montar
 * todo el historial de golpe (8,000 filas × 8 celdas ≈ 70,000 nodos) tardaba
 * ~3.5 s en abrir "Categorías y Comercios", que no tiene filtro de periodo. */
export const FILAS_POR_TANDA = 100;

const COLUMNAS: { titulo: string; derecha?: boolean }[] = [
  { titulo: "Fecha" },
  { titulo: "Descripción" },
  { titulo: "Categoría" },
  { titulo: "Comercio" },
  { titulo: "Tarjeta" },
  { titulo: "Cuenta" },
  { titulo: "Evento" },
  { titulo: "Monto", derecha: true },
];

export const TransaccionesTabla = memo(function TransaccionesTabla({
  transacciones,
  vacio = "No hay transacciones sincronizadas todavía.",
}: {
  transacciones: Transaccion[];
  /** Mensaje cuando no hay filas -- la pestaña de tarjetas lo cambia, porque
   * ahí una tabla vacía casi siempre significa "nada coincide con los
   * filtros", no "aún no hay datos". */
  vacio?: string;
}) {
  const ordenadas = useMemo(
    () => [...transacciones].sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [transacciones]
  );
  // Cuántas se muestran. Vuelve a la primera tanda cuando cambia la lista
  // (otro filtro), ajustando el estado durante el render en vez de un efecto.
  const [visibles, setVisibles] = useState(FILAS_POR_TANDA);
  const [listaAnterior, setListaAnterior] = useState(transacciones);
  if (listaAnterior !== transacciones) {
    setListaAnterior(transacciones);
    setVisibles(FILAS_POR_TANDA);
  }
  const mostradas = ordenadas.length > visibles ? ordenadas.slice(0, visibles) : ordenadas;
  const faltan = ordenadas.length - mostradas.length;
  // 8 columnas no caben en un teléfono ni encogiendo la letra -- en vez de
  // montar la tabla Y las tarjetas a la vez y ocultar una por CSS (el doble
  // de nodos DOM, y cada fila se renderiza dos veces), `useEsMovil` decide
  // cuál de las dos se monta.
  const esMovil = useEsMovil();

  return (
    <div
      className="rounded-lg p-4 tarjeta"
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        Transacciones
      </h3>

      {esMovil ? (
        <div className="mt-3 max-h-96 space-y-2 overflow-auto">
          {mostradas.map((t) => (
            <div
              key={t.id}
              className="rounded-md p-3"
              style={{ border: "1px solid var(--gridline)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {t.descripcion}
                </span>
                <span
                  className="text-sm whitespace-nowrap"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    color: t.tipo === "abono" ? "var(--status-good)" : "var(--text-primary)",
                  }}
                >
                  {t.tipo === "cargo" ? "-" : "+"}
                  {formateadorMoneda.format(t.monto)}
                </span>
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {fechaCorta(t.fecha)} ·{" "}
                {t.documentos.cuentas.alias}
                {t.tarjeta ? ` · ${t.tarjeta}` : ""}
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                {t.categorias?.nombre ?? "Sin categoría"}
                {t.comercio ? ` · ${t.comercio}` : ""}
                {t.eventos?.nombre ? ` · ${t.eventos.nombre}` : ""}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                {COLUMNAS.map((c) => (
                  <th
                    key={c.titulo}
                    className={`py-2 font-medium ${c.derecha ? "text-right" : "text-left"}`}
                    style={{ color: "var(--text-muted)" }}
                  >
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mostradas.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--gridline)" }}>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                    {fechaCorta(t.fecha)}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-primary)" }}>
                    {t.descripcion}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                    {t.categorias?.nombre ?? "—"}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                    {t.comercio ?? "—"}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                    {t.tarjeta ?? "—"}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                    {t.documentos.cuentas.alias}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                    {t.eventos?.nombre ?? "—"}
                  </td>
                  <td
                    className="py-2 text-right"
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      color:
                        t.tipo === "abono"
                          ? "var(--status-good)"
                          : "var(--text-primary)",
                    }}
                  >
                    {t.tipo === "cargo" ? "-" : "+"}
                    {formateadorMoneda.format(t.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {faltan > 0 && (
        <div
          className="mt-2 flex flex-wrap items-center gap-3 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <span>
            Mostrando {entero.format(mostradas.length)} de {entero.format(ordenadas.length)}
          </span>
          <button
            onClick={() => setVisibles((v) => v + FILAS_POR_TANDA)}
            className="underline"
            style={{ color: "var(--text-secondary)" }}
          >
            Mostrar {entero.format(Math.min(FILAS_POR_TANDA, faltan))} más
          </button>
          <button
            onClick={() => setVisibles(ordenadas.length)}
            className="underline"
            style={{ color: "var(--text-secondary)" }}
          >
            Mostrar todas
          </button>
        </div>
      )}

      {ordenadas.length === 0 && (
        <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          {vacio}
        </p>
      )}
    </div>
  );
});
