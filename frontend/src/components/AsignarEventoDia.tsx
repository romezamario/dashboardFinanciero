import { useState } from "react";

/**
 * Asignar un evento a varios movimientos del día a la vez (casillas en la tabla de detalle o
 * "todo el día"): se escribe o elige el evento y se asigna; "Quitar evento" lo vacía. Lo usan
 * "Por correo" (avisos) y "Por estado de cuenta" (transacciones): el que lo monta decide en
 * `onAsignarEvento` a qué tabla se guarda. Un evento nuevo se crea en el catálogo `eventos`.
 */
export function AsignarEventoDia({
  idsDelDia,
  seleccion,
  onCambiarSeleccion,
  conEvento,
  eventosExistentes,
  onAsignarEvento,
  idLista,
  nota,
}: {
  /** Ids de todos los movimientos del día (para "Seleccionar todo el día"). */
  idsDelDia: string[];
  seleccion: Set<string>;
  onCambiarSeleccion: (seleccion: Set<string>) => void;
  /** Cuántos de los seleccionados ya tienen un evento (habilita "Quitar evento"). */
  conEvento: number;
  eventosExistentes: string[];
  /** Asigna (o quita, con null) el evento a los ids; debe guardar y refrescar la vista. */
  onAsignarEvento: (ids: string[], evento: string | null) => Promise<void>;
  /** Id único del <datalist> de sugerencias (varias vistas pueden coexistir). */
  idLista: string;
  /** Texto extra bajo la explicación (p. ej. el aviso de que los eventos empiezan ocultos). */
  nota?: string;
}) {
  const [evento, setEvento] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const ids = Array.from(seleccion);
  const nombreEvento = evento.trim();
  const todoElDia = idsDelDia.length > 0 && seleccion.size === idsDelDia.length;

  async function aplicar(valor: string | null) {
    setTrabajando(true);
    setMensaje(null);
    try {
      await onAsignarEvento(ids, valor);
      setMensaje({
        tipo: "ok",
        texto:
          valor === null
            ? `Se quitó el evento de ${ids.length} movimiento(s).`
            : `Se asignó "${valor}" a ${ids.length} movimiento(s).`,
      });
      onCambiarSeleccion(new Set());
      if (valor !== null) setEvento("");
    } catch (e) {
      setMensaje({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo guardar." });
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <section
      className="rounded-md p-3"
      style={{ background: "var(--page-plane)", border: "1px solid var(--border)" }}
    >
      <h3
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-secondary)" }}
      >
        Asignar evento
      </h3>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Marca los movimientos de las tablas (o todo el día) y asígnales un evento.
        {nota ? ` ${nota}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="w-full text-xs sm:w-auto" style={{ color: "var(--text-secondary)" }}>
          Evento
          <input
            type="text"
            list={idLista}
            value={evento}
            onChange={(e) => setEvento(e.target.value)}
            placeholder="ej. 2026-10 Shophunters"
            className="mt-1 block w-full rounded-md px-3 py-2 text-sm sm:w-64"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          />
          <datalist id={idLista}>
            {eventosExistentes.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          onClick={() => aplicar(nombreEvento)}
          disabled={trabajando || ids.length === 0 || !nombreEvento}
          className="rounded-md px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          style={{ background: "var(--series-1)" }}
        >
          {trabajando ? "Guardando…" : `Asignar a ${ids.length} seleccionado(s)`}
        </button>
        <button
          type="button"
          onClick={() => aplicar(null)}
          disabled={trabajando || conEvento === 0}
          className="rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50"
          style={{
            background: "transparent",
            border: "1px solid var(--status-critical)",
            color: "var(--status-critical)",
          }}
          title="Vacía el evento de los movimientos seleccionados que lo tengan"
        >
          Quitar evento
        </button>
        <button
          type="button"
          onClick={() => onCambiarSeleccion(new Set(todoElDia ? [] : idsDelDia))}
          className="text-xs underline"
          style={{ color: "var(--series-1)" }}
        >
          {todoElDia ? "Quitar la selección" : "Seleccionar todo el día"}
        </button>
      </div>
      {mensaje && (
        <p
          className="mt-2 text-xs"
          role="status"
          style={{ color: mensaje.tipo === "ok" ? "var(--status-good)" : "var(--status-critical)" }}
        >
          {mensaje.texto}
        </p>
      )}
    </section>
  );
}
