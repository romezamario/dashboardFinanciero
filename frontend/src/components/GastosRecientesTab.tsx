import { useEffect, useState } from "react";
import { obtenerGastosCorreo, type GastoCorreo } from "../lib/gastosCorreo";
import type { Transaccion } from "../lib/types";
import { GastosCorreoTab } from "./GastosCorreoTab";
import { GastosEstadoCuentaTab } from "./GastosEstadoCuentaTab";
import { VISTA_CALENDARIO_INICIAL, type VistaCalendario } from "../lib/gastosUI";
import { Segmentado } from "./Segmentado";

interface GastosRecientesTabProps {
  transacciones: Transaccion[];
  categoriasOcultas: Set<string>;
  onCambiarCategoriasOcultas: (cambio: (anteriores: Set<string>) => Set<string>) => void;
  eventosOcultos: Set<string>;
  onCambiarEventosOcultos: (cambio: (anteriores: Set<string>) => Set<string>) => void;
  onActualizado: (ids?: string[]) => void | Promise<void>;
}

/** Pestaña "Gastos recientes": el mismo calendario con dos fuentes. "Por
 * correo" (la de siempre) son los avisos de compra de Banamex: casi en tiempo
 * real, solo compras con tarjeta, desde el primer aviso cargado. "Por estado de cuenta" son los PDF
 * ya sincronizados: todo el historial y todas las cuentas, pero con el atraso
 * del último corte. Al abrir la pestaña se muestra la de correo. */
export function GastosRecientesTab(props: GastosRecientesTabProps) {
  const [fuente, setFuente] = useState<"correo" | "estados">("correo");
  // El mes y el día elegidos se comparten entre las dos fuentes: al cambiar de
  // una a otra el calendario se queda donde estaba (acotado a lo que haya).
  const [vista, setVista] = useState<VistaCalendario>(VISTA_CALENDARIO_INICIAL);
  // Los avisos de correo se cargan aquí, una vez al abrir la pestaña, y no en
  // GastosCorreoTab: esa vista se desmonta al cambiar de fuente y volvería a
  // consultar (y a mostrar "Cargando…") cada vez que se regresa a ella.
  const [gastosCorreo, setGastosCorreo] = useState<GastoCorreo[] | null>(null);
  const [errorCorreo, setErrorCorreo] = useState<string | null>(null);
  useEffect(() => {
    obtenerGastosCorreo()
      .then(setGastosCorreo)
      .catch((e) => setErrorCorreo(e instanceof Error ? e.message : String(e)));
  }, []);
  const cambiarVista = (cambio: (anterior: VistaCalendario) => VistaCalendario) => setVista(cambio);
  return (
    <div className="space-y-6">
      <Segmentado
        opciones={[
          { id: "correo", etiqueta: "Por correo" },
          { id: "estados", etiqueta: "Por estado de cuenta" },
        ]}
        valor={fuente}
        onCambiar={setFuente}
      />
      {fuente === "correo" ? (
        <GastosCorreoTab
          gastos={gastosCorreo}
          error={errorCorreo}
          vista={vista} onCambiarVista={cambiarVista} />
      ) : (
        <GastosEstadoCuentaTab
          {...props}
          gastosCorreo={gastosCorreo}
          errorCorreo={errorCorreo}
          vista={vista}
          onCambiarVista={cambiarVista}
        />
      )}
    </div>
  );
}
