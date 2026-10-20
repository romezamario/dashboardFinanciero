import type { ReactNode } from "react";
import type { CuentaExistente } from "../lib/importar/guardarExcel";
import type { CuentaElegida } from "../lib/importar/cuentaElegida";
import { estiloEntrada } from "../lib/estilos";

// Piezas que comparten la subida de PDFs (SubirEstadoCuenta), la de Excel
// (SubirExcel) y la captura a mano (CapturaManual).

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
          : { background: "var(--marca)", color: "white" }
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

/** "¿De qué cuenta o tarjeta son?": las del cliente o una nueva. */
export function ElegirCuenta({
  cuentas,
  valor,
  onCambiar,
  pregunta = "¿De qué cuenta o tarjeta son?",
}: {
  cuentas: readonly CuentaExistente[];
  valor: CuentaElegida;
  onCambiar: (valor: CuentaElegida) => void;
  pregunta?: string;
}) {
  const nueva = valor.cuentaId === "";
  return (
    <div className="space-y-2">
      <label className="block text-sm" style={{ color: "var(--text-secondary)" }}>
        {pregunta}
        <select
          value={valor.cuentaId}
          onChange={(e) => onCambiar({ ...valor, cuentaId: e.target.value })}
          className="mt-1 block w-full rounded-md px-3 py-1.5 text-sm sm:max-w-sm"
          style={estiloEntrada}
        >
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.alias}
              {c.ultimos4 ? ` ····${c.ultimos4}` : ""}
            </option>
          ))}
          <option value="">Una cuenta nueva…</option>
        </select>
      </label>
      {nueva && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-40 flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Nombre de la cuenta
            <input
              value={valor.alias}
              onChange={(e) => onCambiar({ ...valor, alias: e.target.value })}
              maxLength={60}
              placeholder="Ej. BBVA débito, Efectivo"
              className="mt-1 block w-full rounded-md px-3 py-1.5 text-sm"
              style={estiloEntrada}
            />
          </label>
          <label className="block w-36 text-sm" style={{ color: "var(--text-secondary)" }}>
            Últimos 4 (opcional)
            <input
              value={valor.ultimos4}
              onChange={(e) => onCambiar({ ...valor, ultimos4: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              inputMode="numeric"
              className="mt-1 block w-full rounded-md px-3 py-1.5 text-sm"
              style={estiloEntrada}
            />
          </label>
          <label className="flex items-center gap-2 py-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={valor.tarjetaCredito}
              onChange={(e) => onCambiar({ ...valor, tarjetaCredito: e.target.checked })}
            />
            Es tarjeta de crédito
          </label>
        </div>
      )}
      {nueva && valor.alias.trim() === "" && <Nota tipo="aviso">Ponle un nombre a la cuenta para poder guardar.</Nota>}
      {nueva && valor.ultimos4 !== "" && valor.ultimos4.length < 4 && (
        <Nota tipo="aviso">Los últimos dígitos deben ser 4, o déjalos vacíos.</Nota>
      )}
    </div>
  );
}
