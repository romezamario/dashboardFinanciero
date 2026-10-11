import { Fragment, type ReactNode } from "react";

// Diagramas de la wiki. Todos son cajas HTML (no SVG con coordenadas fijas)
// para que el texto se acomode en un teléfono: en pantallas medianas los
// flujos van de izquierda a derecha y en el teléfono de arriba abajo.
//
// Dónde corre cada paso se marca con un color de borde superior + su nombre
// escrito (el color nunca va solo): laptop, nube, navegador, externo.

export type Lugar = "laptop" | "nube" | "navegador" | "externo" | "neutro";

const COLOR_LUGAR: Record<Lugar, string> = {
  laptop: "var(--series-2)",
  nube: "var(--series-1)",
  navegador: "var(--series-3)",
  externo: "var(--series-4)",
  neutro: "var(--border)",
};

const NOMBRE_LUGAR: Record<Exclude<Lugar, "neutro">, string> = {
  laptop: "Tu laptop",
  nube: "Nube (Supabase / Cloudflare / GitHub)",
  navegador: "Tu navegador",
  externo: "Servicio externo",
};

export interface Nodo {
  titulo: string;
  detalle?: string;
  lugar?: Lugar;
  /** Texto pequeño arriba del título (dónde exactamente, archivo, tabla). */
  donde?: string;
}

/** Caja de un paso. `donde` se muestra arriba; el color del borde dice el lugar. */
export function Caja({ titulo, detalle, lugar = "neutro", donde }: Nodo) {
  return (
    <div
      className="min-w-0 flex-1 rounded-md px-3 py-2"
      style={{
        border: "1px solid var(--border)",
        borderTop: `3px solid ${COLOR_LUGAR[lugar]}`,
        background: "var(--surface-1)",
      }}
    >
      {donde && (
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {donde}
        </div>
      )}
      <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {titulo}
      </div>
      {detalle && (
        <div className="text-xs leading-snug" style={{ color: "var(--text-secondary)" }}>
          {detalle}
        </div>
      )}
    </div>
  );
}

/** Flecha entre pasos: → en pantallas medianas, ↓ en el teléfono (o siempre ↓
 * en un flujo vertical), con su etiqueta. */
function Flecha({ etiqueta, vertical }: { etiqueta?: string; vertical: boolean }) {
  return (
    <div
      className={
        vertical
          ? "flex items-center gap-2 py-1 pl-4 text-xs"
          : "flex items-center gap-2 py-1 pl-4 text-xs md:w-24 md:shrink-0 md:flex-col md:justify-center md:gap-0 md:p-0 md:text-center"
      }
      style={{ color: "var(--text-muted)" }}
    >
      <span aria-hidden="true" className="text-base leading-none">
        {vertical ? "↓" : <><span className="md:hidden">↓</span><span className="hidden md:inline">→</span></>}
      </span>
      {etiqueta && <span className="leading-tight">{etiqueta}</span>}
    </div>
  );
}

export interface Paso extends Nodo {
  /** Etiqueta de la flecha que sale de este paso hacia el siguiente. */
  luego?: string;
}

/** Secuencia de pasos con flechas. Horizontal desde pantallas medianas si
 * caben (≤ 4 pasos); vertical siempre con `vertical`. */
export function Flujo({ pasos, vertical = false, titulo }: { pasos: Paso[]; vertical?: boolean; titulo?: string }) {
  return (
    <figure className="flex flex-col gap-2">
      {titulo && <TituloDiagrama>{titulo}</TituloDiagrama>}
      <div className={vertical ? "flex flex-col" : "flex flex-col md:flex-row md:items-stretch"}>
        {pasos.map((p, i) => (
          <Fragment key={i}>
            <Caja {...p} />
            {i < pasos.length - 1 && <Flecha etiqueta={p.luego} vertical={vertical} />}
          </Fragment>
        ))}
      </div>
    </figure>
  );
}

/** Un origen que se reparte en varios caminos paralelos (columnas). */
export function Ramas({
  origen,
  ramas,
  titulo,
  destino,
}: {
  origen: Nodo;
  ramas: { etiqueta: string; pasos: Paso[] }[];
  titulo?: string;
  /** Opcional: dónde vuelven a juntarse los caminos. */
  destino?: Nodo;
}) {
  return (
    <figure className="flex flex-col gap-2">
      {titulo && <TituloDiagrama>{titulo}</TituloDiagrama>}
      <Caja {...origen} />
      <div className={`grid gap-3 ${ramas.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {ramas.map((r) => (
          <div key={r.etiqueta} className="flex flex-col">
            <Flecha etiqueta={r.etiqueta} vertical />
            {r.pasos.map((p, i) => (
              <Fragment key={i}>
                <Caja {...p} />
                {i < r.pasos.length - 1 && <Flecha etiqueta={p.luego} vertical />}
              </Fragment>
            ))}
          </div>
        ))}
      </div>
      {destino && (
        <>
          <Flecha vertical etiqueta="se juntan" />
          <Caja {...destino} />
        </>
      )}
    </figure>
  );
}

export interface Pregunta {
  pregunta: string;
  /** Qué pasa si la respuesta es "sí" (sale a la derecha). */
  si: string;
  /** Etiqueta de la flecha hacia abajo (por defecto "No"). */
  no?: string;
}

/** Árbol de decisión lineal: cada pregunta, si se cumple, termina en su
 * resultado; si no, baja a la siguiente. Al final, `alFinal`. */
export function Decisiones({
  inicio,
  preguntas,
  alFinal,
  titulo,
}: {
  inicio?: string;
  preguntas: Pregunta[];
  alFinal: string;
  titulo?: string;
}) {
  return (
    <figure className="flex flex-col gap-2">
      {titulo && <TituloDiagrama>{titulo}</TituloDiagrama>}
      {inicio && (
        <>
          <div
            className="self-start rounded-full px-3 py-1 text-xs font-medium"
            style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
          >
            {inicio}
          </div>
          <Flecha vertical />
        </>
      )}
      <div className="flex flex-col">
        {preguntas.map((p, i) => (
          <Fragment key={i}>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <div
                className="rounded-md px-3 py-2 text-sm sm:w-1/2"
                style={{
                  border: "1px dashed var(--text-muted)",
                  color: "var(--text-primary)",
                }}
              >
                <span aria-hidden="true">◇ </span>
                {p.pregunta}
              </div>
              <div className="flex items-center gap-2 pl-4 text-xs sm:pl-0" style={{ color: "var(--text-muted)" }}>
                <span aria-hidden="true">→</span>
                <span className="font-medium" style={{ color: "var(--status-good)" }}>
                  Sí
                </span>
              </div>
              <div
                className="rounded-md px-3 py-2 text-xs sm:flex-1"
                style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
              >
                {p.si}
              </div>
            </div>
            <Flecha vertical etiqueta={p.no ?? "No"} />
          </Fragment>
        ))}
        <div
          className="rounded-md px-3 py-2 text-xs sm:w-1/2"
          style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
        >
          {alFinal}
        </div>
      </div>
    </figure>
  );
}

/** Capas una dentro de otra: hay que pasar la de afuera para llegar a la de
 * adentro (seguridad, alcance de los filtros). */
export function Capas({ capas, titulo }: { capas: Nodo[]; titulo?: string }) {
  function capa(i: number): ReactNode {
    const c = capas[i];
    return (
      <div
        className="rounded-lg p-3"
        style={{
          border: "1px solid var(--border)",
          borderLeft: `3px solid ${COLOR_LUGAR[c.lugar ?? "neutro"]}`,
          background: i % 2 === 0 ? "var(--surface-1)" : "transparent",
        }}
      >
        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {c.titulo}
        </div>
        {c.detalle && (
          <div className="mb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            {c.detalle}
          </div>
        )}
        {i < capas.length - 1 && capa(i + 1)}
      </div>
    );
  }
  return (
    <figure className="flex flex-col gap-2">
      {titulo && <TituloDiagrama>{titulo}</TituloDiagrama>}
      {capa(0)}
    </figure>
  );
}

/** Tabla de la base de datos para el diagrama de relaciones. */
export interface TablaER {
  nombre: string;
  columnas: string[];
  /** Columnas que apuntan a otra tabla: "columna → tabla". */
  apunta?: string[];
  lugar?: Lugar;
}

/** Diagrama de relaciones: cada tabla como tarjeta, sus llaves foráneas
 * escritas como "→ tabla" (sin líneas cruzadas que en un teléfono no se
 * leerían), ordenadas de las que dependen de otras a las de catálogo. */
export function DiagramaRelaciones({ tablas, titulo }: { tablas: TablaER[]; titulo?: string }) {
  return (
    <figure className="flex flex-col gap-2">
      {titulo && <TituloDiagrama>{titulo}</TituloDiagrama>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tablas.map((t) => (
          <div
            key={t.nombre}
            className="rounded-md"
            style={{
              border: "1px solid var(--border)",
              borderTop: `3px solid ${COLOR_LUGAR[t.lugar ?? "nube"]}`,
              background: "var(--surface-1)",
            }}
          >
            <div
              className="px-3 py-1.5 font-mono text-sm font-semibold"
              style={{ color: "var(--text-primary)", borderBottom: "1px solid var(--border)" }}
            >
              {t.nombre}
            </div>
            <ul className="px-3 py-1.5 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
              {t.columnas.map((c) => (
                <li key={c}>{c}</li>
              ))}
              {t.apunta?.map((a) => (
                <li key={a} style={{ color: "var(--series-1)" }}>
                  {a}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Días de una semana marcados como contados o no (meta de gasto diario). */
export function SemanaEjemplo({
  dias,
  titulo,
}: {
  dias: { dia: string; monto: string; estado: "gasto" | "cero" | "fuera" }[];
  titulo?: string;
}) {
  const estilo = {
    gasto: { borde: "var(--series-2)", texto: "cuenta" },
    cero: { borde: "var(--series-1)", texto: "cuenta como $0" },
    fuera: { borde: "var(--border)", texto: "no cuenta" },
  } as const;
  return (
    <figure className="flex flex-col gap-2">
      {titulo && <TituloDiagrama>{titulo}</TituloDiagrama>}
      <div className="grid grid-cols-7 gap-1">
        {dias.map((d) => (
          <div
            key={d.dia}
            className="rounded px-1 py-1.5 text-center"
            style={{
              border: `1px ${d.estado === "fuera" ? "dashed" : "solid"} ${estilo[d.estado].borde}`,
              opacity: d.estado === "fuera" ? 0.6 : 1,
            }}
          >
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {d.dia}
            </div>
            <div className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
              {d.monto}
            </div>
            <div className="text-[10px] leading-tight" style={{ color: "var(--text-muted)" }}>
              {estilo[d.estado].texto}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Qué significa cada color de borde en los diagramas. */
export function LeyendaLugares() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
      {(Object.keys(NOMBRE_LUGAR) as (keyof typeof NOMBRE_LUGAR)[]).map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1 w-4 rounded" style={{ background: COLOR_LUGAR[l] }} />
          {NOMBRE_LUGAR[l]}
        </span>
      ))}
    </div>
  );
}

function TituloDiagrama({ children }: { children: ReactNode }) {
  return (
    <figcaption className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
      {children}
    </figcaption>
  );
}
