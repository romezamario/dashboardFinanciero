import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ContextoMetaDiaria, useMetaDiaria } from "../hooks/metaDiariaContexto";
import { formatoMoneda } from "../lib/gastosUI";
import { META_GASTO_DIARIO, parsearMeta } from "../lib/metaDiaria";
import { guardarMetaDiaria, obtenerMetaDiaria } from "../lib/preferencias";

/**
 * Lee la meta de gasto diario guardada (una vez, al abrir "Gastos recientes") y la comparte
 * con los dos calendarios (por correo y por estado de cuenta): cambiarla en uno cambia el
 * otro, y queda guardada en Supabase.
 */
export function ProveedorMetaDiaria({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState(META_GASTO_DIARIO);
  const [cargada, setCargada] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    obtenerMetaDiaria()
      .then((guardada) => vigente && guardada !== null && setMeta(guardada))
      .catch((e) => vigente && setErrorCarga(e instanceof Error ? e.message : String(e)))
      .finally(() => vigente && setCargada(true));
    return () => {
      vigente = false;
    };
  }, []);

  const guardar = useCallback(async (pesos: number) => {
    await guardarMetaDiaria(pesos);
    setMeta(pesos);
  }, []);

  const valor = useMemo(() => ({ meta, cargada, errorCarga, guardar }), [meta, cargada, errorCarga, guardar]);
  return <ContextoMetaDiaria.Provider value={valor}>{children}</ContextoMetaDiaria.Provider>;
}

/** "Meta: $1,000 de gasto al día · Cambiar": edita la meta y la guarda. */
export function MetaEditable() {
  const { meta, cargada, errorCarga, guardar } = useMetaDiaria();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abrir = () => {
    setTexto(String(meta));
    setError(null);
    setEditando(true);
  };

  async function aplicar(pesos: number) {
    setGuardando(true);
    setError(null);
    try {
      await guardar(pesos);
      setEditando(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la meta.");
    } finally {
      setGuardando(false);
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const pesos = parsearMeta(texto);
    if (pesos === null) {
      setError("Escribe un monto mayor a 0 (en pesos).");
      return;
    }
    void aplicar(pesos);
  }

  if (!editando) {
    return (
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Meta: {cargada ? `${formatoMoneda.format(meta)} de gasto al día` : "…"}{" "}
        <button
          type="button"
          onClick={abrir}
          disabled={!cargada}
          className="underline disabled:opacity-50"
          style={{ color: "var(--series-1)" }}
          title="Cambiar la meta de gasto diario (se guarda)"
        >
          Cambiar
        </button>
        {errorCarga && (
          <span style={{ color: "var(--status-critical)" }}>
            {" "}
            · No se pudo leer tu meta guardada ({errorCarga}); se usa {formatoMoneda.format(META_GASTO_DIARIO)}.
          </span>
        )}
      </span>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-wrap items-end gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
      <label>
        Meta de gasto diario (pesos)
        <input
          type="text"
          inputMode="decimal"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoFocus
          className="mt-1 block w-36 rounded-md px-3 py-2 text-sm"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
      </label>
      <button
        type="submit"
        disabled={guardando}
        className="rounded-md px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        style={{ background: "var(--series-1)" }}
      >
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      {meta !== META_GASTO_DIARIO && (
        <button
          type="button"
          disabled={guardando}
          onClick={() => void aplicar(META_GASTO_DIARIO)}
          className="text-xs underline disabled:opacity-50"
          style={{ color: "var(--series-1)" }}
        >
          Restablecer a {formatoMoneda.format(META_GASTO_DIARIO)}
        </button>
      )}
      <button
        type="button"
        disabled={guardando}
        onClick={() => setEditando(false)}
        className="text-xs underline"
        style={{ color: "var(--text-muted)" }}
      >
        Cancelar
      </button>
      {error && (
        <span role="alert" style={{ color: "var(--status-critical)" }}>
          {error}
        </span>
      )}
    </form>
  );
}
