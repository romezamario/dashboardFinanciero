import { useEffect, useState } from "react";
import { obtenerEstadoGmail, revisarGmailAhora, textoEstadoGmail, type EstadoGmail as Estado } from "../lib/gmailNube";

/**
 * Encabezado de "Por correo": cuándo se revisó Gmail por última vez en la nube (la
 * Edge Function `revisar-gmail`, cada 15 min) y el botón "Revisar ahora". Si la
 * revisión trajo avisos nuevos o recategorizó, `onRecargar` vuelve a pedir los avisos.
 */
export function EstadoGmail({ onRecargar }: { onRecargar: () => Promise<void> }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);

  // Sube tras cada "Revisar ahora" para volver a leer el estado.
  const [lectura, setLectura] = useState(0);
  useEffect(() => {
    let vigente = true;
    obtenerEstadoGmail().then(
      (e) => {
        if (!vigente) return;
        setEstado(e);
        setErrorEstado(null);
      },
      (e) => vigente && setErrorEstado(e instanceof Error ? e.message : String(e))
    );
    return () => {
      vigente = false;
    };
  }, [lectura]);

  async function revisar() {
    setRevisando(true);
    setAviso(null);
    try {
      const r = await revisarGmailAhora();
      if (r.resultado === "ok" || r.resultado === "sin_reglas") {
        setAviso({
          texto: r.nuevos
            ? `Listo: ${r.nuevos} aviso${r.nuevos === 1 ? "" : "s"} nuevo${r.nuevos === 1 ? "" : "s"}.`
            : "Listo: no hay avisos nuevos.",
          error: false,
        });
      } else {
        setAviso({ texto: r.mensaje ?? "La revisión falló.", error: true });
      }
      if (r.nuevos || r.recategorizados) await onRecargar();
    } catch (e) {
      setAviso({ texto: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setRevisando(false);
      setLectura((n) => n + 1);
    }
  }

  if (errorEstado) {
    return (
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        No se pudo leer el estado de Gmail: {errorEstado}
      </p>
    );
  }
  if (!estado) return null;
  const { texto, problema } = textoEstadoGmail(estado);
  const ultimaBien = estado.ultimaBien;
  const pendientes = (ultimaBien?.sin_categoria.length ?? 0) + (ultimaBien?.codigos_sin_confirmar.length ?? 0);
  return (
    <div className="tarjeta px-3 py-2 text-xs space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex-1 min-w-[12rem]" style={{ color: problema ? "var(--status-critical)" : "var(--text-secondary)" }}>
          {problema ? "⚠ " : ""}
          {texto}
        </p>
        {estado.conexion && (
          <button
            type="button"
            onClick={revisar}
            disabled={revisando}
            className="rounded-md border px-3 py-2 sm:py-1 font-medium disabled:opacity-60"
            style={{ borderColor: "var(--marca)", color: "var(--marca)" }}
          >
            {revisando ? "Revisando…" : "Revisar ahora"}
          </button>
        )}
      </div>
      {aviso && <p style={{ color: aviso.error ? "var(--status-critical)" : "var(--text-secondary)" }}>{aviso.texto}</p>}
      {ultimaBien && pendientes > 0 && (
        <details>
          <summary className="cursor-pointer" style={{ color: "var(--text-secondary)" }}>
            Pendientes de los últimos 3 días: {ultimaBien.sin_categoria.length} sin categoría
            {ultimaBien.codigos_sin_confirmar.length ? `, ${ultimaBien.codigos_sin_confirmar.length} códigos de ciudad sin confirmar` : ""}
          </summary>
          <div className="mt-1 space-y-1" style={{ color: "var(--text-secondary)" }}>
            {ultimaBien.sin_categoria.length > 0 && (
              <p>
                Agrega una regla en la app de escritorio para: <span className="font-mono">{ultimaBien.sin_categoria.join(" · ")}</span>
              </p>
            )}
            {ultimaBien.codigos_sin_confirmar.length > 0 && (
              <p>Códigos de ciudad sin confirmar (data/gastos_correo/ciudades.json): {ultimaBien.codigos_sin_confirmar.join(", ")}</p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
