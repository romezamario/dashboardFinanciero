import { useCallback, useEffect, useState } from "react";
import { obtenerGastosCorreo, type FilaGastoCorreo } from "../lib/gastosCorreo";

/**
 * Los avisos de correo de "Gastos recientes", cargados UNA vez por sesión del tablero y
 * guardados aquí (en el Dashboard), no en la pestaña: la pestaña se desmonta al salir de
 * ella y volvía a bajar todo el historial de avisos (miles de filas, varias páginas) cada
 * vez que se abría. Se empiezan a bajar en cuanto `empezar` es true (el Dashboard lo pone
 * al terminar su carga inicial), así que al abrir la pestaña normalmente ya están. Si la
 * carga falló, `reintentar` la repite (la pestaña lo llama al abrirse).
 */
export function useGastosCorreo(empezar: boolean) {
  const [filas, setFilas] = useState<FilaGastoCorreo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    if (!empezar) return;
    let vigente = true;
    obtenerGastosCorreo().then(
      (cargadas) => vigente && setFilas(cargadas),
      (e) => vigente && setError(e instanceof Error ? e.message : String(e))
    );
    return () => {
      vigente = false;
    };
  }, [empezar, intento]);
  const reintentar = useCallback(() => {
    setError(null);
    setIntento((n) => n + 1);
  }, []);
  return { filas, error, setFilas, reintentar };
}
