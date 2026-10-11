import { useState } from "react";
import { supabase } from "../lib/supabase";
import { NOMBRE_APP } from "../lib/edicion";

/** `onVolver`: solo en FinanzasPersonales, regresa a la landing page. */
export function Login({ onVolver }: { onVolver?: () => void } = {}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function iniciarSesion(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setCargando(false);
    if (error) setError(error.message);
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--page-plane)" }}
    >
      <form
        onSubmit={iniciarSesion}
        className="w-full max-w-sm rounded-lg p-6 tarjeta"
      >
        <h1
          className="text-lg font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {NOMBRE_APP}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Inicia sesión para ver tus transacciones.
        </p>

        <label
          className="mt-4 block text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          Correo
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md px-3 py-2 text-sm"
            style={{
              background: "var(--page-plane)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          />
        </label>

        <label
          className="mt-3 block text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          Contraseña
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md px-3 py-2 text-sm"
            style={{
              background: "var(--page-plane)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          />
        </label>

        {error && (
          <p className="mt-3 text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={cargando}
          className="mt-4 w-full rounded-md py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--series-1)" }}
        >
          {cargando ? "Entrando..." : "Entrar"}
        </button>

        {onVolver && (
          <>
            <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
              ¿Aún no tienes cuenta? Estamos en beta cerrada; el registro abre pronto.
            </p>
            <button
              type="button"
              onClick={onVolver}
              className="mt-3 text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              ← Volver al inicio
            </button>
          </>
        )}
      </form>
    </div>
  );
}
