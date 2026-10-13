import { useEffect, useMemo, useState } from "react";
import { filaAGastoCorreo, type FilaGastoCorreo } from "../lib/gastosCorreo";
import { asignarEventoAGastosCorreo, eventoDe, type Catalogos } from "../lib/queries";
import type { Transaccion } from "../lib/types";
import { GastosCorreoTab } from "./GastosCorreoTab";
import { GastosEstadoCuentaTab } from "./GastosEstadoCuentaTab";
import { VISTA_CALENDARIO_INICIAL, type VistaCalendario } from "../lib/gastosUI";
import { Segmentado } from "./Segmentado";
import { EDICION, incluyeFuncion } from "../lib/edicion";

interface GastosRecientesTabProps {
  transacciones: Transaccion[];
  categoriasOcultas: Set<string>;
  onCambiarCategoriasOcultas: (cambio: (anteriores: Set<string>) => Set<string>) => void;
  eventosOcultos: Set<string>;
  onCambiarEventosOcultos: (cambio: (anteriores: Set<string>) => Set<string>) => void;
  onActualizado: (ids?: string[]) => void | Promise<void>;
  /** Catálogo de eventos del Dashboard: resuelve el `evento_id` de cada aviso. */
  eventosCatalogo: Catalogos["eventos"];
  /** Avisos de correo (null = cargando). Los carga el Dashboard una vez por sesión (ver
   * `useGastosCorreo`): aquí se perderían cada vez que se sale de la pestaña. */
  filasCorreo: FilaGastoCorreo[] | null;
  errorCorreo: string | null;
  onCambiarFilasCorreo: (cambio: (previas: FilaGastoCorreo[] | null) => FilaGastoCorreo[] | null) => void;
  /** Vuelve a pedir los avisos (solo se usa si la carga anterior falló). */
  onReintentarCorreo: () => void;
}

/** Pestaña "Gastos recientes": el mismo calendario con dos fuentes. "Por
 * correo" (la de siempre) son los avisos de compra de Banamex: casi en tiempo
 * real, solo compras con tarjeta, desde el primer aviso cargado. "Por estado de cuenta" son los PDF
 * ya sincronizados: todo el historial y todas las cuentas, pero con el atraso
 * del último corte. Al abrir la pestaña se muestra la de correo. */
export function GastosRecientesTab(props: GastosRecientesTabProps) {
  // En el producto, "Por correo" está oculto hasta que el cliente pueda conectar su correo
  // (fase 2): solo se ve el calendario de los estados de cuenta, sin selector ni coincidencias.
  const conCorreo = incluyeFuncion(EDICION, "correo");
  const [fuente, setFuente] = useState<"correo" | "estados">(conCorreo ? "correo" : "estados");
  // El mes y el día elegidos se comparten entre las dos fuentes: al cambiar de
  // una a otra el calendario se queda donde estaba (acotado a lo que haya).
  const [vista, setVista] = useState<VistaCalendario>(VISTA_CALENDARIO_INICIAL);
  const { eventosCatalogo, filasCorreo, errorCorreo, onCambiarFilasCorreo, onReintentarCorreo, ...resto } = props;
  // Si la carga en segundo plano falló, se intenta otra vez al abrir la pestaña (antes cada
  // apertura volvía a consultar; así un fallo momentáneo no deja el error toda la sesión).
  useEffect(() => {
    if (conCorreo && errorCorreo) onReintentarCorreo();
    // Solo al montar: reintentar en cada cambio del error podría ciclar si sigue fallando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const gastosCorreo = useMemo(
    () => filasCorreo && filasCorreo.map((f) => filaAGastoCorreo(f, eventosCatalogo)),
    [filasCorreo, eventosCatalogo]
  );
  const cambiarVista = (cambio: (anterior: VistaCalendario) => VistaCalendario) => setVista(cambio);

  // Eventos que ya existen (en los estados de cuenta o en avisos), para sugerirlos al asignar.
  const eventosExistentes = useMemo(() => {
    const nombres = new Set<string>();
    for (const t of props.transacciones) {
      const evento = eventoDe(t);
      if (evento) nombres.add(evento);
    }
    for (const g of gastosCorreo ?? []) if (g.evento) nombres.add(g.evento);
    return Array.from(nombres).sort((a, b) => a.localeCompare(b, "es"));
  }, [props.transacciones, gastosCorreo]);

  // Asigna (o quita, con null) un evento a avisos del correo. Se guarda en Supabase y se
  // refleja en lo ya cargado (sin volver a pedir todos los avisos). Primero se releen los
  // catálogos (`onActualizado([])`), para que un evento NUEVO ya tenga nombre al mostrarse.
  async function asignarEvento(ids: string[], evento: string | null) {
    const eventoId = await asignarEventoAGastosCorreo(ids, evento);
    await props.onActualizado([]);
    const afectados = new Set(ids);
    onCambiarFilasCorreo((previas) =>
      previas && previas.map((f) => (afectados.has(f.id) ? { ...f, evento_id: eventoId } : f))
    );
  }
  return (
    <div className="space-y-6">
      {conCorreo && (
        <Segmentado
          opciones={[
            { id: "correo", etiqueta: "Por correo" },
            { id: "estados", etiqueta: "Por estado de cuenta" },
          ]}
          valor={fuente}
          onCambiar={setFuente}
        />
      )}
      {conCorreo && fuente === "correo" ? (
        <GastosCorreoTab
          gastos={gastosCorreo}
          error={errorCorreo}
          eventosExistentes={eventosExistentes}
          onAsignarEvento={asignarEvento}
          vista={vista}
          onCambiarVista={cambiarVista}
        />
      ) : (
        <GastosEstadoCuentaTab
          {...resto}
          conCorreo={conCorreo}
          gastosCorreo={gastosCorreo}
          errorCorreo={errorCorreo}
          vista={vista}
          onCambiarVista={cambiarVista}
        />
      )}
    </div>
  );
}
