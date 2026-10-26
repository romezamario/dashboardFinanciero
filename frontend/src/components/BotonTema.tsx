import { useState } from "react";
import { cambiarTema, temaActual, type Tema } from "../lib/tema";

/** Alterna modo claro/oscuro. `compacto`: solo el ícono (encabezado de la
 * página de inicio, donde en el teléfono no cabe el texto). `soloIconoEnMovil`:
 * con texto en escritorio y solo el ícono en pantallas angostas (tablero). */
export function BotonTema({
  compacto = false,
  soloIconoEnMovil = false,
}: {
  compacto?: boolean;
  soloIconoEnMovil?: boolean;
}) {
  const [tema, setTema] = useState<Tema>(temaActual);
  const siguiente: Tema = tema === "dark" ? "light" : "dark";
  const texto = siguiente === "light" ? "Modo claro" : "Modo oscuro";

  return (
    <button
      type="button"
      onClick={() => {
        cambiarTema(siguiente);
        setTema(siguiente);
      }}
      className={
        compacto
          ? "grid h-8 w-8 place-items-center rounded-full"
          : soloIconoEnMovil
            ? "inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-full text-xs font-medium sm:h-auto sm:w-auto sm:px-3 sm:py-1"
            : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
      }
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
      }}
      title={siguiente === "light" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      aria-label={compacto || soloIconoEnMovil ? texto : undefined}
    >
      <Icono tema={siguiente} />
      {soloIconoEnMovil ? <span className="hidden sm:inline">{texto}</span> : !compacto && texto}
    </button>
  );
}

/** Sol para ir a claro, luna para ir a oscuro. */
function Icono({ tema }: { tema: Tema }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {tema === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : (
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      )}
    </svg>
  );
}
