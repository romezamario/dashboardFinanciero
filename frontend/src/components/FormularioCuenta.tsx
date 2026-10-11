import { useId, type ReactNode } from "react";
import { NOMBRE_APP } from "../lib/edicion";

// Piezas compartidas por las pantallas de cuenta (entrar, registro, recuperar
// contraseña, contraseña nueva): una tarjeta centrada con el mismo aspecto
// que tenía el Login.

const estiloEntrada = {
  background: "var(--page-plane)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};

export function PantallaCuenta({
  subtitulo,
  onEnviar,
  children,
}: {
  subtitulo: string;
  onEnviar?: (e: React.FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-8"
      style={{ background: "var(--page-plane)" }}
    >
      <form onSubmit={onEnviar ?? ((e) => e.preventDefault())} className="w-full max-w-sm rounded-lg p-6 tarjeta">
        <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          {NOMBRE_APP}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {subtitulo}
        </p>
        {children}
      </form>
    </div>
  );
}

export function Campo({
  etiqueta,
  tipo = "text",
  valor,
  onCambiar,
  autoComplete,
  requerido = true,
  ayuda,
}: {
  etiqueta: string;
  tipo?: "text" | "email" | "password";
  valor: string;
  onCambiar: (valor: string) => void;
  autoComplete?: string;
  requerido?: boolean;
  ayuda?: string;
}) {
  const idAyuda = useId();
  return (
    <div className="mt-3 first-of-type:mt-4">
      <label className="block text-sm" style={{ color: "var(--text-secondary)" }}>
        {etiqueta}
        <input
          type={tipo}
          required={requerido}
          value={valor}
          autoComplete={autoComplete}
          aria-describedby={ayuda ? idAyuda : undefined}
          onChange={(e) => onCambiar(e.target.value)}
          className="mt-1 w-full rounded-md px-3 py-2 text-sm"
          style={estiloEntrada}
        />
      </label>
      {ayuda && (
        <p id={idAyuda} className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {ayuda}
        </p>
      )}
    </div>
  );
}

export function BotonEnviar({ cargando, texto, textoCargando }: { cargando: boolean; texto: string; textoCargando: string }) {
  return (
    <button
      type="submit"
      disabled={cargando}
      className="mt-4 w-full rounded-md py-2 text-sm font-medium text-white disabled:opacity-60"
      style={{ background: "var(--series-1)" }}
    >
      {cargando ? textoCargando : texto}
    </button>
  );
}

/** Error (rojo) o aviso de éxito (verde), siempre con texto: nunca solo color. */
export function Aviso({ tipo, children }: { tipo: "error" | "exito"; children: ReactNode }) {
  return (
    <p
      role={tipo === "error" ? "alert" : "status"}
      className="mt-3 text-sm"
      style={{ color: tipo === "error" ? "var(--status-critical)" : "var(--status-good)" }}
    >
      {children}
    </p>
  );
}

export function EnlaceCuenta({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  const estilo = { color: "var(--series-1)" };
  if (href)
    return (
      <a href={href} className="text-sm font-medium underline-offset-2 hover:underline" style={estilo}>
        {children}
      </a>
    );
  return (
    <button type="button" onClick={onClick} className="text-sm font-medium underline-offset-2 hover:underline" style={estilo}>
      {children}
    </button>
  );
}
