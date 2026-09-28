import { useEffect, useState } from "react";

// Punto de quiebre "sm" de Tailwind (640px): por debajo, angosto/móvil.
const CONSULTA_MOVIL = "(max-width: 639px)";

/**
 * true en pantallas angostas (~teléfono). Existe para las pocas piezas que
 * NO pueden resolverse solo con clases de Tailwind -- props numéricos de
 * Recharts como el ancho del eje Y o los márgenes del Sankey, que no
 * aceptan breakpoints por CSS y necesitan un valor de JS distinto en
 * móvil. Se actualiza en vivo si la ventana cambia de tamaño o el
 * dispositivo rota, no solo al montar.
 */
export function useEsMovil(): boolean {
  const [esMovil, setEsMovil] = useState(
    () => typeof window !== "undefined" && window.matchMedia(CONSULTA_MOVIL).matches
  );

  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_MOVIL);
    const escuchar = (e: MediaQueryListEvent) => setEsMovil(e.matches);
    consulta.addEventListener("change", escuchar);
    return () => consulta.removeEventListener("change", escuchar);
  }, []);

  return esMovil;
}
