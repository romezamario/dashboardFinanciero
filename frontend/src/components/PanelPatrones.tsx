import type { ReactNode } from "react";
import type { Patron, Vela } from "../lib/patrones";
import type { NivelTecnico } from "../lib/tecnico";
import {
  colorDeSesgo,
  ETIQUETA_CALIDAD,
  fechaCorta,
  precio2,
  RELLENO_CALIDAD,
  volumenCompacto,
  type Seleccion,
} from "./dibujoPatrones";
import { Tabla } from "./IndicadoresUI";

// Chips para activar los patrones, contenido de las tarjetas (al pasar el
// ratón o al hacer clic) y el panel de trazabilidad: las velas exactas
// (fecha, OHLC, volumen) que originan cada patrón o nivel.

/** Botón para activar una familia de patrones; deshabilitado y con "No detectado" si no hay ninguno. */
export function ChipPatron({
  etiqueta,
  cantidad,
  activo,
  onClick,
}: {
  etiqueta: string;
  cantidad: number;
  activo: boolean;
  onClick: () => void;
}) {
  const hay = cantidad > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!hay}
      aria-pressed={hay ? activo : undefined}
      title={hay ? `Mostrar u ocultar ${etiqueta} sobre el gráfico` : `${etiqueta}: ninguna detección en el rango visible cumple todas las reglas`}
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs disabled:cursor-not-allowed"
      style={{
        border: `1px solid ${hay && activo ? "var(--text-primary)" : "var(--border)"}`,
        background: hay && activo ? "var(--gridline)" : "transparent",
        color: hay ? (activo ? "var(--text-primary)" : "var(--text-secondary)") : "var(--text-muted)",
        opacity: hay ? 1 : 0.7,
      }}
    >
      {etiqueta}
      <span style={{ color: hay ? "var(--text-secondary)" : "var(--text-muted)" }}>
        {hay ? `· ${cantidad}` : "· No detectado"}
      </span>
    </button>
  );
}

// ------------------------------------------------------- contenido de tarjetas

function RenglonRegla({ r }: { r: Patron["reglas"][number] }) {
  return (
    <li className="flex gap-1.5">
      <span
        aria-hidden="true"
        style={{ color: r.cumple ? "var(--status-good)" : "var(--status-critical)" }}
        className="shrink-0"
      >
        {r.cumple ? "✓" : "✗"}
      </span>
      <span className="min-w-0">
        <span style={{ color: "var(--text-primary)" }}>
          <span className="sr-only">{r.cumple ? "Cumple: " : "No cumple: "}</span>
          {r.texto}
        </span>
        {r.detalle && <span style={{ color: "var(--text-muted)" }}> — {r.detalle}</span>}
        {!r.obligatoria && <span style={{ color: "var(--text-muted)" }}> (calidad)</span>}
      </span>
    </li>
  );
}

/** Contenido de la tarjeta de un patrón: qué reglas cumple y cuáles no. */
export function ContenidoPatron({ patron, conPista = true }: { patron: Patron; conPista?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="pr-5">
        <p className="font-semibold" style={{ color: colorDeSesgo(patron) }}>
          {patron.nombre}
        </p>
        <p style={{ color: "var(--text-secondary)" }}>
          {RELLENO_CALIDAD[patron.calidad]} {ETIQUETA_CALIDAD[patron.calidad]} ({Math.round(patron.puntaje * 100)}% de las reglas de calidad) ·{" "}
          {fechaCorta(patron.fechaInicio)} → {fechaCorta(patron.fechaFin)}
        </p>
      </div>
      <ul className="space-y-0.5">
        {patron.reglas.map((r) => (
          <RenglonRegla key={r.texto} r={r} />
        ))}
      </ul>
      {patron.ruptura && (
        <p style={{ color: "var(--text-secondary)" }}>
          Ruptura {patron.ruptura.direccion} el {fechaCorta(patron.ruptura.fecha)} (cierre{" "}
          {precio2.format(patron.ruptura.precio)}
          {patron.ruptura.volumenRelativo !== null && `, volumen ${patron.ruptura.volumenRelativo.toFixed(2)}× su promedio`})
        </p>
      )}
      {patron.objetivo && (
        <p style={{ color: "var(--text-primary)" }}>
          Objetivo teórico: <strong>{precio2.format(patron.objetivo.precio)}</strong>
          <span style={{ color: "var(--text-muted)" }}> — {patron.objetivo.descripcion}</span>
        </p>
      )}
      {conPista && (
        <p style={{ color: "var(--text-muted)" }}>Haz clic para ver las velas exactas que lo originan.</p>
      )}
    </div>
  );
}

/** Contenido de la tarjeta de un nivel: por qué se clasificó así y de qué pivotes sale. */
export function ContenidoNivel({ nivel, conPista = true }: { nivel: NivelTecnico; conPista?: boolean }) {
  const colorTipo = nivel.tipo === "resistencia" ? "var(--status-critical)" : "var(--status-good)";
  return (
    <div className="space-y-1.5">
      <p className="pr-5 font-semibold" style={{ color: colorTipo }}>
        {nivel.nombre}
      </p>
      <p style={{ color: "var(--text-secondary)" }}>{nivel.motivo}</p>
      {nivel.pivotes.length > 0 ? (
        <div>
          <p style={{ color: "var(--text-muted)" }}>
            Pivotes que lo sostienen ({nivel.pivotes.length}):
          </p>
          <ul className="mt-0.5 space-y-0.5 tabular-nums">
            {[...nivel.pivotes]
              .sort((a, b) => a.fecha.localeCompare(b.fecha))
              .map((p) => (
                <li key={`${p.fecha}-${p.tipo}`}>
                  {fechaCorta(p.fecha)} · {p.tipo === "maximo" ? "máx." : "mín."} {precio2.format(p.precio)}
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <p style={{ color: "var(--text-muted)" }}>Sin pivotes: sale solo de la media o del máximo indicado.</p>
      )}
      {conPista && <p style={{ color: "var(--text-muted)" }}>Haz clic para ver las velas exactas.</p>}
    </div>
  );
}

// ------------------------------------------------------------- trazabilidad

function filaDeVela(v: Vela, rol: string): ReactNode[] {
  return [
    fechaCorta(v.fecha),
    rol,
    precio2.format(v.apertura),
    precio2.format(v.maximo),
    precio2.format(v.minimo),
    precio2.format(v.cierre),
    volumenCompacto.format(v.volumen),
  ];
}

const ENCABEZADOS_VELA = ["Fecha", "Rol", "Apertura", "Máximo", "Mínimo", "Cierre", "Volumen"];

/** Panel con lo que originó el patrón o nivel elegido: reglas y velas exactas (fecha, OHLC, volumen). */
export function DetalleTrazabilidad({
  seleccion,
  onCerrar,
}: {
  seleccion: Seleccion;
  onCerrar: () => void;
}) {
  const esPatron = seleccion.tipo === "patron";
  const titulo = esPatron ? seleccion.patron.nombre : seleccion.nivel.nombre;
  const filas = esPatron
    ? seleccion.patron.velasOrigen.map((v) => {
        const roles = seleccion.patron.puntos.filter((p) => p.fecha === v.fecha).map((p) => p.etiqueta);
        return filaDeVela(v, roles.join(", ") || "—");
      })
    : seleccion.nivel.velasOrigen.map((v) => {
        const pivote = seleccion.nivel.pivotes.find((p) => p.fecha === v.fecha);
        return filaDeVela(
          v,
          pivote ? (pivote.tipo === "maximo" ? "Pivote máx." : "Pivote mín.") : "Vela de referencia"
        );
      });
  return (
    <div className="space-y-3 rounded-lg p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Trazabilidad: {titulo}
        </h3>
        <button type="button" onClick={onCerrar} className="text-xs underline" style={{ color: "var(--text-muted)" }}>
          Cerrar
        </button>
      </div>
      <div className="text-xs">
        {esPatron ? (
          <ContenidoPatron patron={seleccion.patron} conPista={false} />
        ) : (
          <ContenidoNivel nivel={seleccion.nivel} conPista={false} />
        )}
      </div>
      <Tabla titulo="Velas exactas que lo originan" vacio="Sin velas." encabezados={ENCABEZADOS_VELA} filas={filas} />
    </div>
  );
}
