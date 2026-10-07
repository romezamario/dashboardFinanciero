import type { ReactNode } from "react";
import type { Sumas } from "../lib/gastosCorreo";
import { dinero } from "../lib/gastosUI";

// Piezas de las tablas del detalle de un día, compartidas por "Por correo" y
// "Por estado de cuenta": mismas columnas por tarjeta/cuenta.

export function CeldasSumas({ sumas, columnas }: { sumas: Sumas; columnas: string[] }) {
  return (
    <>
      {columnas.map((c) => (
        <td key={c} className="px-3 py-1.5 text-right tabular-nums">
          {dinero(sumas.porTarjeta[c])}
        </td>
      ))}
      <td className="px-3 py-1.5 text-right tabular-nums">{dinero(sumas.total)}</td>
    </>
  );
}

export function CabeceraColumnas({
  columnas,
  nombre,
}: {
  columnas: string[];
  nombre: (columna: string) => string;
}) {
  return (
    <>
      {columnas.map((c) => (
        <th key={c} className="px-3 py-2 text-right font-semibold">
          {nombre(c)}
        </th>
      ))}
      <th className="px-3 py-2 text-right font-semibold">Total</th>
    </>
  );
}

/** Título pequeño + tabla con borde y scroll horizontal (un teléfono no
 * cabe tantas columnas). */
export function SeccionTabla({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-secondary)" }}
      >
        {titulo}
      </h3>
      {nota && (
        <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {nota}
        </p>
      )}
      <div className="overflow-x-auto rounded" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-xs" style={{ color: "var(--text-primary)" }}>
          {children}
        </table>
      </div>
    </section>
  );
}
