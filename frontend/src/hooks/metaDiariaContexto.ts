import { createContext, useContext } from "react";
import { META_GASTO_DIARIO } from "../lib/metaDiaria";

export interface MetaDiariaContexto {
  /** Meta de gasto diario en pesos (la guardada, o `META_GASTO_DIARIO` por defecto). */
  meta: number;
  /** false mientras se lee la guardada: hasta entonces no se pinta nada contra la meta. */
  cargada: boolean;
  /** Si no se pudo leer la meta guardada (se usa la de por defecto). */
  errorCarga: string | null;
  /** Guarda una meta nueva en Supabase; lanza si falla (la meta visible no cambia). */
  guardar: (pesos: number) => Promise<void>;
}

// Vive aparte de `MetaDiaria.tsx` (que solo exporta componentes) para que el refresco en
// caliente de Vite siga funcionando.
export const ContextoMetaDiaria = createContext<MetaDiariaContexto>({
  meta: META_GASTO_DIARIO,
  cargada: true,
  errorCarga: null,
  guardar: async () => {},
});

export const useMetaDiaria = () => useContext(ContextoMetaDiaria);
