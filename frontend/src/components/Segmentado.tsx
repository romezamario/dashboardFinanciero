/** Selector de 2+ opciones en una píldora (una sola activa). Lo usan la
 * pestaña "QQQ / TQQQ" (Análisis técnico | Macro EE.UU.) y "Gastos
 * recientes" (Por correo | Por estado de cuenta). */
export function Segmentado<T extends string>({
  opciones,
  valor,
  onCambiar,
  chico = false,
}: {
  opciones: { id: T; etiqueta: string; deshabilitada?: boolean; tituloDeshabilitada?: string }[];
  valor: T;
  onCambiar: (valor: T) => void;
  chico?: boolean;
}) {
  return (
    <div
      className="inline-flex rounded-md p-0.5"
      style={{ background: "var(--page-plane)", border: "1px solid var(--border)" }}
    >
      {opciones.map((o) => (
        <button
          key={o.id}
          onClick={() => onCambiar(o.id)}
          disabled={o.deshabilitada}
          title={o.deshabilitada ? o.tituloDeshabilitada : undefined}
          className={`rounded ${chico ? "px-2 py-0.5" : "px-3 py-1"} text-xs font-medium disabled:opacity-40`}
          style={{
            background: valor === o.id ? "var(--surface-1)" : "transparent",
            color: valor === o.id ? "var(--text-primary)" : "var(--text-secondary)",
            boxShadow: valor === o.id ? "0 0 0 1px var(--border)" : undefined,
          }}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}
