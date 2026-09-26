// Piezas de presentación de los indicadores (recuadros, variaciones y
// tablas) que usa la vista fusionada Resumen/Indicadores (VistaResumen).

export interface PropsDelta {
  texto: string;
  /** Dirección del cambio (flecha), independiente de si es bueno o malo:
   * más gasto sube (▲) aunque sea desfavorable. */
  sube: boolean;
  /** Favorable/desfavorable (color). */
  favorable: boolean;
}

export function Delta({ texto, sube, favorable }: PropsDelta) {
  // El color de estado nunca va solo: flecha + texto cargan el significado.
  return (
    <span style={{ color: favorable ? "var(--status-good)" : "var(--status-critical)" }}>
      {sube ? "▲" : "▼"} {texto}
    </span>
  );
}

export function Tile({
  etiqueta,
  valor,
  detalle,
  delta,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  delta?: PropsDelta;
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {etiqueta}
      </div>
      <div className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {valor}
      </div>
      {delta && (
        <div className="mt-1 text-xs">
          <Delta {...delta} />
        </div>
      )}
      {detalle && (
        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {detalle}
        </div>
      )}
    </div>
  );
}

export function Tabla({
  titulo,
  vacio,
  encabezados,
  filas,
}: {
  titulo: string;
  vacio: string;
  encabezados: string[];
  filas: React.ReactNode[][];
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {titulo}
      </h3>
      {filas.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {vacio}
        </p>
      ) : (
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                {encabezados.map((e, i) => (
                  <th
                    key={e}
                    className={`whitespace-nowrap py-2 font-medium ${i === 0 ? "text-left" : "pl-3 text-right"}`}
                    style={{ color: "var(--text-muted)" }}
                  >
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={String(fila[0])} style={{ borderBottom: "1px solid var(--gridline)" }}>
                  {fila.map((celda, i) => (
                    <td
                      key={i}
                      className={`whitespace-nowrap py-2 ${i === 0 ? "text-left" : "pl-3 text-right"}`}
                      style={{
                        color: i === 0 ? "var(--text-primary)" : "var(--text-secondary)",
                        fontVariantNumeric: i === 0 ? undefined : "tabular-nums",
                      }}
                    >
                      {celda}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
