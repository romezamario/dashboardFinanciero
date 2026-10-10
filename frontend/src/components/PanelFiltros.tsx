import { useState, type ReactNode } from "react";
import type { Filtros } from "../lib/queries";

// Controles de filtrado del Resumen en una sola tarjeta, para que no se vean
// amontonados: arriba los filtros por clic (cuenta, tarjeta, evento) en filas
// con la etiqueta alineada; abajo, plegado por defecto, lo que se EXCLUYE de
// todo el análisis (categorías ocultas y eventos descartados) con un resumen
// de lo que está excluido -- casi nunca se cambia, así que no necesita estar
// siempre desplegado. La lógica (qué hace cada clic) vive en VistaResumen;
// aquí solo se dibuja.

interface PanelFiltrosProps {
  filtros: Filtros;
  cuentas: string[];
  tarjetas: string[];
  /** Eventos que se pueden aislar por clic (los no descartados). */
  eventosVisibles: string[];
  onFiltrar: (campo: "cuenta" | "tarjeta", valor: string) => void;
  onFiltrarEvento: (evento: string) => void;

  categorias: string[];
  categoriasOcultas: Set<string>;
  onAlternarCategoria: (categoria: string) => void;
  onMostrarCategorias: () => void;
  eventos: string[];
  eventosOcultos: Set<string>;
  onAlternarEvento: (evento: string) => void;
  onMostrarEventos: () => void;
}

export function PanelFiltros({
  filtros,
  cuentas,
  tarjetas,
  eventosVisibles,
  onFiltrar,
  onFiltrarEvento,
  categorias,
  categoriasOcultas,
  onAlternarCategoria,
  onMostrarCategorias,
  eventos,
  eventosOcultos,
  onAlternarEvento,
  onMostrarEventos,
}: PanelFiltrosProps) {
  const [verExclusiones, setVerExclusiones] = useState(false);

  const hayFiltrosPorClic = cuentas.length > 1 || tarjetas.length > 0 || eventosVisibles.length > 0;
  // En el orden en que aparecen las píldoras, para que el resumen plegado
  // coincida con lo que se ve al desplegar.
  const excluidas = [
    ...categorias.filter((c) => categoriasOcultas.has(c)),
    ...eventos.filter((e) => eventosOcultos.has(e)),
  ];

  return (
    <div
      className="flex flex-col gap-3 rounded-lg p-4 tarjeta"
    >
      {hayFiltrosPorClic && (
        <div className="flex flex-col gap-2">
          {cuentas.length > 1 && (
            <Fila etiqueta="Cuenta">
              {cuentas.map((cuenta) => (
                <PildoraFiltro
                  key={cuenta}
                  texto={cuenta}
                  activa={filtros.cuenta === cuenta}
                  onClick={() => onFiltrar("cuenta", cuenta)}
                />
              ))}
            </Fila>
          )}
          {tarjetas.length > 0 && (
            <Fila etiqueta="Tarjeta">
              {tarjetas.map((tarjeta) => (
                <PildoraFiltro
                  key={tarjeta}
                  texto={tarjeta}
                  activa={filtros.tarjeta === tarjeta}
                  onClick={() => onFiltrar("tarjeta", tarjeta)}
                />
              ))}
            </Fila>
          )}
          {eventosVisibles.length > 0 && (
            <Fila etiqueta="Evento">
              {eventosVisibles.map((evento) => (
                <PildoraFiltro
                  key={evento}
                  texto={evento}
                  activa={filtros.evento === evento}
                  onClick={() => onFiltrarEvento(evento)}
                />
              ))}
            </Fila>
          )}
        </div>
      )}

      <div
        className="flex flex-col gap-2"
        style={hayFiltrosPorClic ? { borderTop: "1px solid var(--border)", paddingTop: 12 } : undefined}
      >
        <button
          type="button"
          onClick={() => setVerExclusiones((v) => !v)}
          aria-expanded={verExclusiones}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>
            {verExclusiones ? "▾" : "▸"}
          </span>
          <span className="font-medium">Excluir del análisis</span>
          <span style={{ color: "var(--text-muted)" }}>
            {excluidas.length === 0
              ? "· nada excluido"
              : `· ${excluidas.join(", ")}`}
          </span>
          <span className="underline" style={{ color: "var(--text-muted)" }}>
            {verExclusiones ? "Listo" : "Editar"}
          </span>
        </button>

        {verExclusiones && (
          <>
            <Fila etiqueta="Categorías">
              {categorias.map((categoria) => (
                <PildoraExclusion
                  key={categoria}
                  texto={categoria}
                  excluida={categoriasOcultas.has(categoria)}
                  onClick={() => onAlternarCategoria(categoria)}
                />
              ))}
              {categoriasOcultas.size > 0 && (
                <EnlaceTexto onClick={onMostrarCategorias}>Mostrar todas</EnlaceTexto>
              )}
            </Fila>
            {eventos.length > 0 && (
              <Fila etiqueta="Eventos">
                {eventos.map((evento) => (
                  <PildoraExclusion
                    key={evento}
                    texto={evento}
                    excluida={eventosOcultos.has(evento)}
                    onClick={() => onAlternarEvento(evento)}
                  />
                ))}
                {eventosOcultos.size > 0 && (
                  <EnlaceTexto onClick={onMostrarEventos}>Mostrar todos</EnlaceTexto>
                )}
              </Fila>
            )}
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Lo excluido desaparece de todo el dashboard, indicadores incluidos. Por defecto se
              excluyen los pagos entre tus propias cuentas (p. ej. "Pago TDC").
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Etiqueta en su propia columna (alineada entre filas) en pantallas
 * medianas; arriba de las píldoras en un teléfono. */
export function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="shrink-0 text-xs sm:w-20" style={{ color: "var(--text-muted)" }}>
        {etiqueta}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function PildoraFiltro({ texto, activa, onClick }: { texto: string; activa: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className="rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        background: activa ? "var(--series-1)" : "transparent",
        border: `1px solid ${activa ? "var(--series-1)" : "var(--border)"}`,
        color: activa ? "#ffffff" : "var(--text-secondary)",
      }}
      title={activa ? "Quitar este filtro" : "Filtrar por esto"}
    >
      {texto}
    </button>
  );
}

export function PildoraExclusion({
  texto,
  excluida,
  onClick,
  titulo,
}: {
  texto: string;
  excluida: boolean;
  onClick: () => void;
  /** Texto del tooltip cuando no es el del Resumen ("de todo el dashboard"). */
  titulo?: string;
}) {
  // El estado "excluida" no depende solo del color: tachado + borde.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={excluida}
      className="rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        background: "transparent",
        border: `1px solid ${excluida ? "var(--status-critical)" : "var(--border)"}`,
        color: excluida ? "var(--status-critical)" : "var(--text-secondary)",
        textDecoration: excluida ? "line-through" : "none",
      }}
      title={titulo ?? (excluida ? "Volver a incluir" : "Excluir de todo el dashboard")}
    >
      {texto}
    </button>
  );
}

export function EnlaceTexto({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 text-xs underline" style={{ color: "var(--text-muted)" }}>
      {children}
    </button>
  );
}
