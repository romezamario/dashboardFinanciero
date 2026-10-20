import { NOMBRE_APP } from "../lib/edicion";

// Logo de Ordena tu Lana (manual de marca v2, 2026-10-20): una O gruesa con tres
// tarjetas detrás (azul, amarillo, verde) y dos rayitas. El trazo es el mismo de
// /mnt/project-files/marca/simbolo.svg. El halo que separa la O de las tarjetas
// toma el color del fondo (`halo`), y la O el del texto, así funciona en claro
// y en oscuro sin otra versión.

const VIEWBOX = "60 220 620 510";

export function SimboloMarca({
  className,
  halo = "var(--page-plane)",
  tinta = "var(--text-primary)",
}: {
  className?: string;
  halo?: string;
  tinta?: string;
}) {
  return (
    <svg viewBox={VIEWBOX} className={className} aria-hidden="true" focusable="false">
      <rect x="470" y="440" width="185" height="222" rx="42" fill="#41c27a" transform="rotate(-8 562 551)" />
      <rect x="395" y="362" width="205" height="315" rx="58" fill="#f9cd4e" transform="rotate(-6 497 519)" />
      <rect x="298" y="288" width="222" height="400" rx="46" fill="#1073ee" transform="rotate(-6 409 488)" />
      <circle cx="265" cy="522" r="196" fill={halo} />
      <path fill={tinta} fillRule="evenodd" d="M265 337a185 185 0 1 0 0.01 0ZM265 431a91 91 0 1 0 0.01 0Z" />
      <g stroke={tinta} strokeWidth="17" strokeLinecap="round">
        <path d="M571 246 558 310" />
        <path d="M644 296 600 342" />
      </g>
    </svg>
  );
}

/** Símbolo + nombre en dos líneas ("Ordena" / "tu Lana", con "tu" en azul). */
export function LogoMarca({ grande = false, halo }: { grande?: boolean; halo?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={NOMBRE_APP}>
      <SimboloMarca className={grande ? "h-14 w-auto" : "h-10 w-auto"} halo={halo} />
      <span
        aria-hidden="true"
        className={`titular-marca grid font-bold ${grande ? "text-[28px]" : "text-[18px]"}`}
        style={{ lineHeight: 0.9, color: "var(--text-primary)" }}
      >
        <span>Ordena</span>
        <span>
          <span style={{ color: "var(--marca)" }}>tu</span> Lana
        </span>
      </span>
    </span>
  );
}
