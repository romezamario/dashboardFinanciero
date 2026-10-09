import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const MARGEN = 8;

/**
 * Tarjetita flotante del estilo de los tooltips de las gráficas, junto a un
 * punto de la ventana (`x`, `y`: coordenadas del clic o del ratón). Se mantiene
 * dentro de la ventana (se corre hacia adentro o se abre hacia arriba).
 *
 * - `fija` (abierta con un clic): se cierra con Escape, con un clic fuera de
 *   ella, con la × o al hacer scroll/cambiar el tamaño de la ventana (ya no
 *   estaría junto a lo que explica).
 * - sin `fija` (solo al pasar el ratón): no recibe el ratón, para no tapar lo
 *   que la abrió ni parpadear; quien la abrió la quita al salir.
 */
export function TarjetaFlotante({
  x,
  y,
  fija = true,
  etiqueta,
  ancho = "w-80",
  onCerrar,
  children,
}: {
  x: number;
  y: number;
  fija?: boolean;
  /** `aria-label` del diálogo. */
  etiqueta: string;
  /** Clase de ancho de Tailwind (w-80 por defecto). */
  ancho?: string;
  onCerrar: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [posicion, setPosicion] = useState({ left: x + 12, top: y + 12 });

  useLayoutEffect(() => {
    const caja = ref.current?.getBoundingClientRect();
    if (!caja) return;
    let left = x + 12;
    let top = y + 12;
    if (left + caja.width > window.innerWidth - MARGEN) {
      left = Math.max(MARGEN, window.innerWidth - caja.width - MARGEN);
    }
    if (top + caja.height > window.innerHeight - MARGEN) {
      top = Math.max(MARGEN, y - caja.height - 12);
    }
    setPosicion({ left, top });
  }, [x, y, children]);

  useEffect(() => {
    if (!fija) return;
    const alTeclear = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    const alPulsarFuera = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    document.addEventListener("mousedown", alPulsarFuera);
    window.addEventListener("scroll", onCerrar, true);
    window.addEventListener("resize", onCerrar);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      document.removeEventListener("mousedown", alPulsarFuera);
      window.removeEventListener("scroll", onCerrar, true);
      window.removeEventListener("resize", onCerrar);
    };
  }, [fija, onCerrar]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={etiqueta}
      className={`fixed z-50 ${ancho} max-w-[calc(100vw-16px)] rounded-lg p-3 text-xs`}
      style={{
        left: posicion.left,
        top: posicion.top,
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
        pointerEvents: fija ? "auto" : "none",
      }}
    >
      {fija && (
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="absolute right-2 top-1.5 px-1 text-base leading-none"
          style={{ color: "var(--text-muted)" }}
        >
          ×
        </button>
      )}
      {children}
    </div>
  );
}
