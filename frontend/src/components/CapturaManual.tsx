import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { CUENTA_NUEVA, cuentaLista, destinoDe, nombreDeCuenta, type CuentaElegida } from "../lib/importar/cuentaElegida";
import { borrarMovimiento, guardarManual, obtenerCuentas, type CuentaExistente } from "../lib/importar/guardarExcel";
import { validarManual, type CamposManual } from "../lib/importar/manual";
import { categorizar, REGLAS_BASE } from "../lib/importar/reglasBase";
import { estiloEntrada } from "../lib/estilos";
import { hoyIso } from "../lib/fechas";
import { fechaCorta, monedaConCentavos } from "../lib/formato";
import type { Transaccion } from "../lib/types";
import { Opcion } from "./OpcionesSubida";
import { ElegirCuenta, Nota } from "./SubirPiezas";

// "Capturar a mano" en "Subir movimientos": un movimiento a la vez (un gasto
// en efectivo, algo que todavía no sale en el estado de cuenta). Se guarda en
// la cuenta elegida igual que una fila de la plantilla de Excel
// (guardarManual); los capturados en esta visita se pueden deshacer.

interface Capturado {
  id: string;
  fecha: string;
  descripcion: string;
  monto: string;
  tipo: "cargo" | "abono";
  cuenta: string;
  borrando?: boolean;
}

const vacio = (fecha: string): CamposManual => ({
  fecha,
  descripcion: "",
  monto: "",
  tipo: "cargo",
  categoria: "",
  comercio: "",
});

export function CapturaManual({ transacciones, onGuardado }: { transacciones: readonly Transaccion[]; onGuardado: () => void }) {
  const hoy = hoyIso();
  const [campos, setCampos] = useState<CamposManual>(() => vacio(hoy));
  const [cuentas, setCuentas] = useState<CuentaExistente[]>([]);
  const [cuenta, setCuenta] = useState<CuentaElegida>(CUENTA_NUEVA);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturados, setCapturados] = useState<Capturado[]>([]);
  const descripcionRef = useRef<HTMLInputElement>(null);
  const idCategorias = useId();
  const idComercios = useId();

  useEffect(() => {
    let vigente = true;
    obtenerCuentas().then(
      (lista) => {
        if (!vigente) return;
        setCuentas(lista);
        // Con cuentas, la primera queda elegida (se ve y se puede cambiar).
        setCuenta((c) => (c.cuentaId === "" && c.alias === "" && lista.length > 0 ? { ...c, cuentaId: lista[0].id } : c));
      },
      // Sin la lista igual se puede guardar en una cuenta nueva.
      () => undefined
    );
    return () => {
      vigente = false;
    };
  }, []);

  const { categorias, comercios } = useMemo(() => {
    const cat = new Set<string>(REGLAS_BASE.map((r) => r.categoria));
    const com = new Set<string>();
    for (const t of transacciones) {
      if (t.categorias?.nombre) cat.add(t.categorias.nombre);
      if (t.comercio) com.add(t.comercio);
    }
    const orden = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, "es"));
    return { categorias: orden(cat), comercios: orden(com) };
  }, [transacciones]);

  const sugerida = campos.categoria.trim() === "" ? categorizar(campos.descripcion) : null;
  const cambiar = (cambio: Partial<CamposManual>) => setCampos((c) => ({ ...c, ...cambio }));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const { movimiento, error: invalido } = validarManual(campos, hoyIso());
    if (!movimiento) {
      setError(invalido);
      return;
    }
    if (!cuentaLista(cuenta)) {
      setError("Elige la cuenta o ponle nombre a la nueva.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const { id, cuentaId } = await guardarManual(destinoDe(cuenta), movimiento);
      const nombre = nombreDeCuenta(cuenta, cuentas);
      setCapturados((lista) => [
        { id, fecha: movimiento.fecha, descripcion: movimiento.descripcion, monto: movimiento.monto, tipo: movimiento.tipo, cuenta: nombre },
        ...lista,
      ]);
      // Para capturar el siguiente: misma fecha, tipo y cuenta (la nueva ya
      // existe y aparece en la lista).
      setCampos((c) => ({ ...vacio(c.fecha), tipo: c.tipo }));
      if (cuenta.cuentaId === "") {
        setCuenta({ ...CUENTA_NUEVA, cuentaId });
        obtenerCuentas().then(setCuentas, () => undefined);
      }
      descripcionRef.current?.focus();
      onGuardado();
    } catch (err) {
      setError(`No se pudo guardar el movimiento: ${(err as Error).message}`);
    } finally {
      setGuardando(false);
    }
  }

  async function deshacer(id: string) {
    setCapturados((lista) => lista.map((c) => (c.id === id ? { ...c, borrando: true } : c)));
    try {
      await borrarMovimiento(id);
      setCapturados((lista) => lista.filter((c) => c.id !== id));
      onGuardado();
    } catch (err) {
      setCapturados((lista) => lista.map((c) => (c.id === id ? { ...c, borrando: false } : c)));
      setError(`No se pudo quitar el movimiento: ${(err as Error).message}`);
    }
  }

  const etiqueta = "block text-sm";
  const entrada = "mt-1 block w-full rounded-md px-3 py-1.5 text-sm";

  return (
    <Opcion
      color="var(--series-2)"
      icono={<IconoLapiz />}
      etiqueta="Uno por uno"
      titulo="Capturar a mano"
      descripcion="Para un gasto en efectivo o algo que todavía no sale en tu estado de cuenta."
    >
      <form onSubmit={guardar} className="space-y-3" noValidate>
        <div className="flex flex-wrap items-end gap-3">
          <fieldset>
            <legend className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Tipo
            </legend>
            <div className="mt-1 inline-flex rounded-md p-0.5" style={{ border: "1px solid var(--border)" }}>
              {(
                [
                  ["cargo", "Gasto"],
                  ["abono", "Ingreso"],
                ] as const
              ).map(([valor, texto]) => {
                const activo = campos.tipo === valor;
                return (
                  <label
                    key={valor}
                    className="cursor-pointer rounded px-3 py-1 text-sm font-medium"
                    style={{
                      background: activo ? (valor === "cargo" ? "var(--series-2)" : "var(--series-1)") : "transparent",
                      color: activo ? "white" : "var(--text-secondary)",
                    }}
                  >
                    <input
                      type="radio"
                      name="tipo-manual"
                      value={valor}
                      checked={activo}
                      onChange={() => cambiar({ tipo: valor })}
                      className="sr-only"
                    />
                    {texto}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className={`${etiqueta} w-40`} style={{ color: "var(--text-secondary)" }}>
            Fecha
            <input
              type="date"
              value={campos.fecha}
              max={hoy}
              onChange={(e) => cambiar({ fecha: e.target.value })}
              className={entrada}
              style={estiloEntrada}
            />
          </label>
          <label className={`${etiqueta} w-36`} style={{ color: "var(--text-secondary)" }}>
            Monto
            <input
              value={campos.monto}
              onChange={(e) => cambiar({ monto: e.target.value })}
              inputMode="decimal"
              placeholder="$0.00"
              className={`${entrada} text-right tabular-nums`}
              style={estiloEntrada}
            />
          </label>
        </div>

        <label className={etiqueta} style={{ color: "var(--text-secondary)" }}>
          Descripción
          <input
            ref={descripcionRef}
            value={campos.descripcion}
            onChange={(e) => cambiar({ descripcion: e.target.value })}
            maxLength={200}
            placeholder={campos.tipo === "cargo" ? "Ej. Súper, comida, gasolina" : "Ej. Sueldo, venta, reembolso"}
            className={entrada}
            style={estiloEntrada}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={etiqueta} style={{ color: "var(--text-secondary)" }}>
            Categoría (opcional)
            <input
              value={campos.categoria}
              onChange={(e) => cambiar({ categoria: e.target.value })}
              list={idCategorias}
              maxLength={100}
              placeholder={sugerida ? `Sugerida: ${sugerida.categoria}` : "Ej. Comida"}
              className={entrada}
              style={estiloEntrada}
            />
            <datalist id={idCategorias}>
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className={etiqueta} style={{ color: "var(--text-secondary)" }}>
            Comercio (opcional)
            <input
              value={campos.comercio}
              onChange={(e) => cambiar({ comercio: e.target.value })}
              list={idComercios}
              maxLength={100}
              placeholder={sugerida?.comercio ? `Sugerido: ${sugerida.comercio}` : "Ej. Oxxo"}
              className={entrada}
              style={estiloEntrada}
            />
            <datalist id={idComercios}>
              {comercios.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        </div>
        {sugerida && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Si dejas la categoría vacía, lo guardamos como {sugerida.categoria}.
          </p>
        )}

        <ElegirCuenta cuentas={cuentas} valor={cuenta} onCambiar={setCuenta} pregunta="¿De qué cuenta o tarjeta es?" />

        <div className="flex flex-wrap items-center gap-3">
          <BotonEnviar deshabilitado={guardando} texto={guardando ? "Guardando…" : "Guardar movimiento"} />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Lo puedes cambiar después en tu tablero.
          </span>
        </div>
        {error && <Nota tipo="error">{error}</Nota>}
      </form>

      {capturados.length > 0 && (
        <div>
          <p role="status" className="text-sm font-medium" style={{ color: "var(--status-good)" }}>
            ✓ {capturados.length === 1 ? "1 movimiento guardado" : `${capturados.length} movimientos guardados`}. Ya los
            ves en tu tablero.
          </p>
          <ul className="mt-2 space-y-1">
            {capturados.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md px-3 py-1.5 text-sm"
                style={{ background: "var(--page-plane)", color: "var(--text-primary)" }}
              >
                <span className="whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                  {fechaCorta(c.fecha)}
                </span>
                <span className="min-w-32 flex-1 break-words">{c.descripcion}</span>
                <span className="hidden text-xs sm:inline" style={{ color: "var(--text-muted)" }}>
                  {c.cuenta}
                </span>
                <span
                  className="whitespace-nowrap tabular-nums"
                  style={{ color: c.tipo === "abono" ? "var(--status-good)" : undefined }}
                >
                  {c.tipo === "abono" ? "+" : "−"}
                  {monedaConCentavos.format(Number(c.monto))}
                </span>
                <button
                  type="button"
                  onClick={() => void deshacer(c.id)}
                  disabled={c.borrando}
                  className="text-xs font-medium underline-offset-2 hover:underline disabled:opacity-50"
                  style={{ color: "var(--marca)" }}
                >
                  {c.borrando ? "Quitando…" : "Deshacer"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Opcion>
  );
}

function BotonEnviar({ deshabilitado, texto }: { deshabilitado: boolean; texto: string }) {
  return (
    <button
      type="submit"
      disabled={deshabilitado}
      className="rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-50"
      style={{ background: "var(--series-2)", color: "white" }}
    >
      {texto}
    </button>
  );
}

function IconoLapiz() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}
