import { useEffect, useState } from "react";
import { mensajeErrorSalud, obtenerEstadoSalud, type EstadoSalud } from "../lib/salud";
import { BotonTema } from "./BotonTema";

/** Espacio Salud del dashboard personal. Por ahora solo dice si ya hay datos
 * del anillo Oura; los dashboards se construyen cuando lleguen los primeros. */
export function Salud({ onIrAInicio }: { onIrAInicio: () => void }) {
  const [estado, setEstado] = useState<EstadoSalud | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    obtenerEstadoSalud()
      .then((e) => vigente && setEstado(e))
      .catch((e) => vigente && setError(mensajeErrorSalud(e)));
    return () => {
      vigente = false;
    };
  }, [intento]);

  return (
    <div style={{ background: "var(--page-plane)", minHeight: "100vh" }}>
      <header
        className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onIrAInicio}
            className="h-9 whitespace-nowrap rounded-full px-3 text-xs font-medium sm:h-auto sm:py-1"
            style={{ background: "var(--surface-1)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            title="Volver a la página de inicio"
          >
            ← Inicio
          </button>
          <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            Salud
          </h1>
        </div>
        <BotonTema soloIconoEnMovil />
      </header>

      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <section className="tarjeta p-5">
          {error ? (
            <>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  setIntento((n) => n + 1);
                }}
                className="mt-3 rounded-full px-3 py-1 text-xs font-medium"
                style={{ border: "1px solid var(--border)", color: "var(--marca)" }}
              >
                Reintentar
              </button>
            </>
          ) : !estado ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Cargando…</p>
          ) : estado.dias === 0 ? (
            <>
              <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                Aún no hay datos del anillo
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                Aparecerán aquí cuando la laptop sincronice el anillo Oura y suba el primer resumen.
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                {estado.dias} {estado.dias === 1 ? "día" : "días"} con datos
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                Último día: {estado.ultimoDia ?? "—"}
                {estado.ultimaSubida && ` · Última subida: ${new Date(estado.ultimaSubida).toLocaleString("es-MX")}`}
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
