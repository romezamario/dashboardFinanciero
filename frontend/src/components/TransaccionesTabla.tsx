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

export function TransaccionesTabla({
  transacciones,
}: {
  transacciones: Transaccion[];
}) {
  const ordenadas = [...transacciones].sort((a, b) =>
    b.fecha.localeCompare(a.fecha)
  );

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Transacciones
      </h3>
      <div className="mt-3 max-h-96 overflow-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
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
                Cuenta
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
                  {formateadorFecha.format(new Date(t.fecha + "T00:00:00"))}
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
                  {t.documentos.cuentas.alias}
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
        {ordenadas.length === 0 && (
          <p className="py-6 text-center" style={{ color: "var(--text-muted)" }}>
            No hay transacciones sincronizadas todavía.
          </p>
        )}
      </div>
    </div>
  );
}
