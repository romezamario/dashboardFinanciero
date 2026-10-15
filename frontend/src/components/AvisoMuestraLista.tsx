import type { ReactNode } from "react";
import type { MuestraPorConfirmar } from "../lib/muestras";

// Recompensa por muestras: aviso al cliente de que su muestra ya sirvió para
// un lector (lo ve en el tablero y en "Subir movimientos").

/** "Tu muestra ayudó": el lector ya está; falta que el cliente lo pruebe. */
export function AvisoMuestraLista({ muestra, accion }: { muestra: MuestraPorConfirmar; accion?: ReactNode }) {
  const banco = muestra.banco_lector ?? muestra.banco_detectado;
  return (
    <section className="tarjeta space-y-2 rounded-lg p-4" style={{ borderColor: "var(--status-good)" }}>
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Tu muestra nos ayudó{banco ? ` a leer los estados de cuenta de ${banco}` : ""}.
      </p>
      {muestra.mensaje_cliente && (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {muestra.mensaje_cliente}
        </p>
      )}
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Sube de nuevo ese estado de cuenta, guarda tus movimientos y dinos si ya ves todos.
        {muestra.recompensa && " Cuando nos lo confirmes, te damos tu regalo."}
      </p>
      {accion}
    </section>
  );
}

