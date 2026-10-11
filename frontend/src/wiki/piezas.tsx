import type { ReactNode } from "react";

// Piezas de presentación de la wiki (pestaña "Wiki"). Solo texto con estilo:
// el contenido vive en `contenido.tsx`.

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
      {children}
    </p>
  );
}

export function Sub({ children }: { children: ReactNode }) {
  return (
    <h3 className="pt-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
      {children}
    </h3>
  );
}

export function Lista({ children }: { children: ReactNode }) {
  return (
    <ul
      className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed"
      style={{ color: "var(--text-secondary)" }}
    >
      {children}
    </ul>
  );
}

export function Pasos({ children }: { children: ReactNode }) {
  return (
    <ol
      className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed"
      style={{ color: "var(--text-secondary)" }}
    >
      {children}
    </ol>
  );
}

/** Nombre de archivo, función, columna o constante. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code
      className="rounded px-1 py-0.5 text-[0.8em]"
      style={{ background: "var(--gridline)", color: "var(--text-primary)" }}
    >
      {children}
    </code>
  );
}

/** Lo que importa: en negritas y con color de texto principal. */
export function B({ children }: { children: ReactNode }) {
  return (
    <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>
      {children}
    </strong>
  );
}

/** Recuadro de aviso: una decisión aceptada, una limitación o un "ojo". */
export function Nota({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div
      className="rounded-md px-3 py-2 text-sm leading-relaxed"
      style={{
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--series-4)",
        color: "var(--text-secondary)",
      }}
    >
      <div className="mb-0.5 font-semibold" style={{ color: "var(--text-primary)" }}>
        {titulo}
      </div>
      {children}
    </div>
  );
}

/** Fórmula o regla de cálculo, en una caja aparte para leerla de un vistazo. */
export function Formula({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <div
      className="rounded-md px-3 py-2 text-sm"
      style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
    >
      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
        {nombre}:
      </span>{" "}
      {children}
    </div>
  );
}

export function TablaWiki({ encabezados, filas }: { encabezados: string[]; filas: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {encabezados.map((e) => (
              <th
                key={e}
                className="px-2 py-1.5 text-xs font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                {e}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
              {fila.map((celda, j) => (
                <td
                  key={j}
                  className="px-2 py-1.5 align-top"
                  style={{ color: j === 0 ? "var(--text-primary)" : "var(--text-secondary)" }}
                >
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
