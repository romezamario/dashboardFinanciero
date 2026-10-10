import { useState } from "react";
import type { Alerta, TonoAlerta } from "../lib/alertas";

/** Cuántas alertas se ven antes de "Ver N más". */
const ALERTAS_VISIBLES = 4;

// El color de estado nunca va solo (dataviz): cada tono lleva su ícono y una
// etiqueta de texto. "info" es neutral, sin color de estado.
const ESTILO_TONO: Record<TonoAlerta, { icono: string; etiqueta: string; color: string }> = {
  revisar: { icono: "⚠", etiqueta: "Revisar", color: "var(--status-critical)" },
  favorable: { icono: "✓", etiqueta: "Buena noticia", color: "var(--status-good)" },
  info: { icono: "ℹ", etiqueta: "Para saber", color: "var(--text-secondary)" },
};

interface AlertasPanelProps {
  alertas: Alerta[];
  titulo: string;
  /** Clic en "Ver movimientos": aplica el filtro por clic de la alerta. */
  onVerDetalle: (filtro: NonNullable<Alerta["filtro"]>) => void;
}

/** Bloque "Alertas" del Resumen: las alertas del periodo en frases, las más
 * urgentes primero (ver `calcularAlertas`). */
export function AlertasPanel({ alertas, titulo, onVerDetalle }: AlertasPanelProps) {
  const [verTodas, setVerTodas] = useState(false);
  const mostradas = verTodas ? alertas : alertas.slice(0, ALERTAS_VISIBLES);
  const ocultas = alertas.length - mostradas.length;

  return (
    <section
      className="rounded-lg p-4 tarjeta"
      aria-label="Alertas automáticas"
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {titulo}
      </h3>
      {alertas.length === 0 ? (
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          Nada fuera de lo normal: sin cargos duplicados, cambios de precio, suscripciones
          nuevas ni cargos inusuales en el periodo.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {mostradas.map((alerta, i) => {
            const estilo = ESTILO_TONO[alerta.tono];
            const filtro = alerta.filtro;
            return (
              <li
                key={alerta.id}
                className="flex gap-3 py-2"
                style={{ borderTop: i === 0 ? undefined : "1px solid var(--border)" }}
              >
                <span aria-hidden="true" className="text-base leading-5" style={{ color: estilo.color }}>
                  {estilo.icono}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                    <span className="font-medium">{alerta.titulo}</span>
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {alerta.detalle}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    <span style={{ color: estilo.color }}>{estilo.etiqueta}</span>
                    {filtro && (
                      <button
                        type="button"
                        onClick={() => onVerDetalle(filtro)}
                        className="underline"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Ver movimientos
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(ocultas > 0 || verTodas) && alertas.length > ALERTAS_VISIBLES && (
        <button
          type="button"
          onClick={() => setVerTodas((v) => !v)}
          className="mt-1 text-xs underline"
          style={{ color: "var(--text-muted)" }}
        >
          {verTodas ? "Ver menos" : `Ver ${ocultas} más`}
        </button>
      )}
    </section>
  );
}
