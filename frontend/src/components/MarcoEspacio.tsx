import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { BotonTema } from "./BotonTema";

/** Encabezado y contenedor comunes de un espacio del dashboard personal
 * ("← Inicio", nombre, tema, cerrar sesión). Los subproyectos lo usan para
 * verse igual que el resto sin copiar el encabezado. */
export function MarcoEspacio({
  titulo,
  onIrAInicio,
  acciones,
  children,
}: {
  titulo: string;
  onIrAInicio: () => void;
  /** Botones propios del espacio, a la izquierda del de tema. */
  acciones?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ background: "var(--page-plane)", minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
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
              {titulo}
            </h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-4">
            {acciones}
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
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">{children}</main>
    </div>
  );
}
