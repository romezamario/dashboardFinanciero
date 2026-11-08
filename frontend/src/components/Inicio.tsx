import { supabase } from "../lib/supabase";
import { ESPACIOS, type Espacio } from "../lib/espacios";
import { BotonTema } from "./BotonTema";

function saludo(hora: number): string {
  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";
  return "Buenas noches";
}

/** Página de inicio del dashboard personal: una tarjeta por categoría. Solo
 * Finanzas tiene contenido por ahora; las demás dicen "Próximamente". */
export function Inicio({ onAbrir }: { onAbrir: (espacio: Espacio) => void }) {
  return (
    <div style={{ background: "var(--page-plane)", minHeight: "100vh" }}>
      <header
        className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          Mi dashboard
        </h1>
        <div className="flex items-center gap-1 sm:gap-4">
          <BotonTema soloIconoEnMovil />
          <button
            onClick={() => supabase.auth.signOut()}
            className="h-9 whitespace-nowrap rounded-full px-3 text-xs sm:h-auto sm:py-1"
            style={{ color: "var(--text-secondary)" }}
          >
            <span className="sm:hidden">Salir</span>
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          {saludo(new Date().getHours())}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          ¿Qué quieres revisar hoy?
        </p>

        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ESPACIOS.map((espacio) => (
            <li key={espacio.id}>
              <button
                type="button"
                disabled={!espacio.disponible}
                onClick={() => onAbrir(espacio.id)}
                className="tarjeta flex h-full w-full flex-col items-start gap-2 p-5 text-left transition-shadow enabled:hover:shadow-md"
                style={{
                  cursor: espacio.disponible ? "pointer" : "default",
                  opacity: espacio.disponible ? 1 : 0.65,
                }}
              >
                <span className="text-3xl" aria-hidden="true">
                  {espacio.icono}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                    {espacio.nombre}
                  </span>
                  {!espacio.disponible && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: "var(--page-plane)",color: "var(--text-muted)", border: "1px solid var(--border)" }}
                    >
                      Próximamente
                    </span>
                  )}
                </span>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {espacio.descripcion}
                </span>
                {espacio.disponible && (
                  <span className="mt-auto pt-2 text-xs font-medium" style={{ color: "var(--marca)" }}>
                    Abrir →
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
