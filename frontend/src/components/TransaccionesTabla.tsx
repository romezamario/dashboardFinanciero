import type { Transaccion } from "../lib/types";
import { useEsMovil } from "../hooks/useEsMovil";
import { monedaConCentavos as formateadorMoneda, fechaCorta } from "../lib/formato";

export function TransaccionesTabla({
  transacciones,
  vacio = "No hay transacciones sincronizadas todavía.",
}: {
  transacciones: Transaccion[];
  /** Mensaje cuando no hay filas -- la pestaña de tarjetas lo cambia, porque
   * ahí una tabla vacía casi siempre significa "nada coincide con los
   * filtros", no "aún no hay datos". */
  vacio?: string;
}) {
  const ordenadas = [...transacciones].sort((a, b) =>
    b.fecha.localeCompare(a.fecha)
  );
  // 8 columnas no caben en un teléfono ni encogiendo la letra -- en vez de
  // montar la tabla Y las tarjetas a la vez y ocultar una por CSS (el doble
  // de nodos DOM, y cada fila se renderiza dos veces), `useEsMovil` decide
  // cuál de las dos se monta.
  const esMovil = useEsMovil();

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        Transacciones
      </h3>

      {esMovil ? (
        <div className="mt-3 max-h-96 space-y-2 overflow-auto">
          {ordenadas.map((t) => (
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
                <th
                  className="py-2 text-left font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Fecha
                </th>
                <th
                  className="py-2 text-left font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Descripción
                </th>
                <th
                  className="py-2 text-left font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Categoría
                </th>
                <th
                  className="py-2 text-left font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Comercio
                </th>
                <th
                  className="py-2 text-left font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Tarjeta
                </th>
                <th
                  className="py-2 text-left font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Cuenta
                </th>
                <th
                  className="py-2 text-left font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Evento
                </th>
                <th
                  className="py-2 text-right font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Monto
                </th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((t) => (
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

      {ordenadas.length === 0 && (
        <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          {vacio}
        </p>
      )}
    </div>
  );
}
