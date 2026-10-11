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

/** Una caja del diagrama de arquitectura. */
function Caja({ titulo, detalle, donde }: { titulo: string; detalle: string; donde: string }) {
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{ border: "1px solid var(--border)", background: "var(--surface-1)" }}
    >
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {donde}
      </div>
      <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {titulo}
      </div>
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {detalle}
      </div>
    </div>
  );
}

function Flecha({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-4 text-xs" style={{ color: "var(--text-muted)" }}>
      <span aria-hidden="true">↓</span>
      {texto}
    </div>
  );
}

/** Flujo principal de los datos, de arriba abajo, con dónde corre cada paso.
 * Cajas HTML en vez de un SVG para que en un teléfono el texto se acomode. */
export function DiagramaFlujo() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <div className="mb-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          Estados de cuenta (la fuente principal)
        </div>
        <Caja donde="Tu laptop" titulo="PDF del banco" detalle="Banamex cheques, Banamex TDC, Invex TDC" />
        <Flecha texto="lo cargas en la app de escritorio" />
        <Caja
          donde="Tu laptop · app/ (Tkinter)"
          titulo="Extraer → transformar → categorizar"
          detalle="Parser del banco, montos Decimal, reglas de palabra clave; tú revisas y corriges"
        />
        <Flecha texto='"Guardar archivo procesado"' />
        <Caja
          donde="Tu laptop · data/procesados/"
          titulo="<hash>.json"
          detalle="Solo transacciones normalizadas; el PDF se mueve a su carpeta procesados/"
        />
        <Flecha texto='"Sincronizar a Supabase..." (con tu usuario, RLS)' />
        <Caja
          donde="Nube · Supabase (Postgres)"
          titulo="bancos, cuentas, documentos, categorias, transacciones, eventos"
          detalle="Única fuente de verdad remota; cada fila con user_id"
        />
        <Flecha texto="supabase-js directo desde el navegador" />
        <Caja
          donde="Nube · Cloudflare Pages + Access"
          titulo="Este tablero"
          detalle="Dos logins: Cloudflare Access (correo + PIN) y luego Supabase Auth"
        />
      </div>
      <div>
        <div className="mb-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          Fuentes complementarias
        </div>
        <Caja donde="Tu Gmail" titulo="Avisos de compra de Banamex" detalle="Llegan el mismo día del cargo" />
        <Flecha texto="app de escritorio, pestaña Gmail (solo lectura)" />
        <Caja
          donde="Tu laptop · data/gastos_correo/"
          titulo="Un JSON por día"
          detalle="Categorizados con las mismas reglas"
        />
        <Flecha texto="se suben con tu usuario" />
        <Caja donde="Supabase" titulo="gastos_correo" detalle='Tabla aparte: "Gastos recientes · por correo"' />
        <div className="h-4" />
        <Caja
          donde="Yahoo Finance → Cloudflare Pages Function"
          titulo="Velas de QQQ / TQQQ"
          detalle="/api/cotizaciones, caché de 5 min en Cloudflare"
        />
        <div className="h-2" />
        <Caja
          donde="FRED + federalreserve.gov → GitHub Actions"
          titulo="macro.json"
          detalle="Se genera en cada deploy y dos veces al día hábil"
        />
      </div>
    </div>
  );
}
