import { Component, type ErrorInfo, type ReactNode } from "react";

interface LimiteDeErrorProps {
  /** Qué falló, para el mensaje ("la pestaña Eventos"). */
  nombre: string;
  children: ReactNode;
}

interface LimiteDeErrorState {
  error: Error | null;
}

/**
 * Si algo dentro de una pestaña truena al dibujarse (un dato raro en una
 * gráfica, un caso no previsto en un cálculo), React desmontaría TODO el
 * tablero y quedaría la página en blanco. Este límite lo contiene: solo esa
 * pestaña muestra el error, con "Reintentar"; el encabezado y las demás
 * pestañas siguen funcionando. Va con `key` por pestaña en `Dashboard`, así
 * que cambiar de pestaña también lo reinicia.
 */
export class LimiteDeError extends Component<LimiteDeErrorProps, LimiteDeErrorState> {
  state: LimiteDeErrorState = { error: null };

  static getDerivedStateFromError(error: Error): LimiteDeErrorState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Error en ${this.props.nombre}:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="space-y-3 rounded-lg p-4 text-sm"
        style={{ background: "var(--surface-1)", border: "1px solid var(--status-critical)" }}
      >
        <p style={{ color: "var(--text-primary)" }}>
          Algo falló al mostrar {this.props.nombre}. Las demás pestañas siguen funcionando.
        </p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {error.message}
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          className="rounded-md px-3 py-1 text-xs font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          Reintentar
        </button>
      </div>
    );
  }
}
