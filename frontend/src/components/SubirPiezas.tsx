import type { ReactNode } from "react";

// Piezas que comparten la subida de PDFs (SubirEstadoCuenta) y la de Excel
// (SubirExcel).

export function Boton({
  children,
  onClick,
  deshabilitado,
  secundario,
}: {
  children: ReactNode;
  onClick: () => void;
  deshabilitado?: boolean;
  secundario?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      style={
        secundario
          ? { border: "1px solid var(--border)", color: "var(--text-primary)" }
          : { background: "var(--series-1)", color: "white" }
      }
    >
      {children}
    </button>
  );
}

export function Nota({ tipo, children }: { tipo: "error" | "exito" | "aviso"; children: ReactNode }) {
  const color = { error: "var(--status-critical)", exito: "var(--status-good)", aviso: "var(--text-secondary)" }[tipo];
  return (
    <p role={tipo === "error" ? "alert" : "status"} className="mt-2 text-sm" style={{ color }}>
      {children}
    </p>
  );
}
