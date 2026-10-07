import { useState } from "react";
import type { Transaccion } from "../lib/types";
import { GastosCorreoTab } from "./GastosCorreoTab";
import { GastosEstadoCuentaTab } from "./GastosEstadoCuentaTab";
import { Segmentado } from "./Segmentado";

interface GastosRecientesTabProps {
  transacciones: Transaccion[];
  categoriasOcultas: Set<string>;
  onCambiarCategoriasOcultas: (cambio: (anteriores: Set<string>) => Set<string>) => void;
  onActualizado: () => void | Promise<void>;
}

/** Pestaña "Gastos recientes": el mismo calendario con dos fuentes. "Por
 * correo" (la de siempre) son los avisos de compra de Banamex: casi en tiempo
 * real, solo compras con tarjeta, 60 días. "Por estado de cuenta" son los PDF
 * ya sincronizados: todo el historial y todas las cuentas, pero con el atraso
 * del último corte. Al abrir la pestaña se muestra la de correo. */
export function GastosRecientesTab(props: GastosRecientesTabProps) {
  const [fuente, setFuente] = useState<"correo" | "estados">("correo");
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
      {fuente === "correo" ? <GastosCorreoTab /> : <GastosEstadoCuentaTab {...props} />}
    </div>
  );
}
