import { useEffect, useState } from "react";
import { deCentavos } from "../lib/importar/comun";
import { leerArchivoTabla, type LecturaExcel } from "../lib/importar/excel";
import { guardarExcel, obtenerCuentas, type CuentaExistente } from "../lib/importar/guardarExcel";
import { periodo, totales } from "../lib/importar/procesar";
import { categorizar } from "../lib/importar/reglasBase";
import { fechaCorta, monedaConCentavos } from "../lib/formato";
import {
  CUENTA_NUEVA,
  cuentaLista,
  destinoDe,
  nombreDeCuenta,
  type CuentaElegida,
} from "../lib/importar/cuentaElegida";
import { Boton, ElegirCuenta, Nota } from "./SubirPiezas";

// Un Excel (o CSV) elegido en "Subir estado de cuenta": se lee aquí, en el
// navegador, se muestra la vista previa y el cliente elige a qué cuenta van
// los movimientos antes de guardarlos (lib/importar/excel.ts, guardarExcel.ts).

const FILAS_VISTA_PREVIA = 8;

export function ResultadoExcel({ archivo, onGuardado }: { archivo: File; onGuardado: () => void }) {
  const [lectura, setLectura] = useState<LecturaExcel | null>(null);
  const [errorLectura, setErrorLectura] = useState(false);
  const [cuentas, setCuentas] = useState<CuentaExistente[]>([]);

  useEffect(() => {
    let vigente = true;
    leerArchivoTabla(archivo).then(
      (l) => vigente && setLectura(l),
      () => vigente && setErrorLectura(true)
    );
    obtenerCuentas().then(
      (c) => vigente && setCuentas(c),
      // Sin la lista igual se puede guardar en una cuenta nueva.
      () => undefined
    );
    return () => {
      vigente = false;
    };
  }, [archivo]);

  if (errorLectura)
    return (
      <Nota tipo="error">
        No pudimos abrir este archivo. Guárdalo como Excel (.xlsx) o CSV, de preferencia a partir de la plantilla, e
        inténtalo de nuevo.
      </Nota>
    );
  if (!lectura)
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Leyendo…
      </p>
    );
  if (lectura.movimientos.length === 0)
    return (
      <div>
        {lectura.errores.slice(0, 5).map((e, i) => (
          <Nota key={i} tipo="error">
            {e}
          </Nota>
        ))}
        {lectura.errores.length > 5 && <Nota tipo="aviso">Y {lectura.errores.length - 5} filas más con problemas.</Nota>}
      </div>
    );
  return <VistaPrevia lectura={lectura} cuentas={cuentas} onGuardado={onGuardado} />;
}

function VistaPrevia({
  lectura,
  cuentas,
  onGuardado,
}: {
  lectura: LecturaExcel;
  cuentas: CuentaExistente[];
  onGuardado: () => void;
}) {
  const { movimientos, errores } = lectura;
  const [cuenta, setCuenta] = useState<CuentaElegida>(CUENTA_NUEVA);
  const [verTodos, setVerTodos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardados, setGuardados] = useState<{ n: number; cuenta: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { cargos, abonos } = totales(movimientos);
  const rango = periodo(movimientos);
  const visibles = verTodos ? movimientos : movimientos.slice(0, FILAS_VISTA_PREVIA);
  const categoriaDe = (m: (typeof movimientos)[number]) => m.categoria ?? categorizar(m.descripcion)?.categoria ?? null;
  const conCategoria = movimientos.filter((m) => categoriaDe(m)).length;
  const listo = cuentaLista(cuenta);
  const nombreCuenta = nombreDeCuenta(cuenta, cuentas);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const n = await guardarExcel(destinoDe(cuenta), movimientos);
      setGuardados({ n, cuenta: nombreCuenta });
      onGuardado();
    } catch (e) {
      setError(`No se pudieron guardar los movimientos: ${(e as Error).message}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>
        {movimientos.length} movimientos
        {rango && ` del ${fechaCorta(rango.inicio)} al ${fechaCorta(rango.fin)}`}.
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span style={{ color: "var(--text-secondary)" }}>
          Cargos: <strong style={{ color: "var(--text-primary)" }}>{monedaConCentavos.format(Number(deCentavos(cargos)))}</strong>
        </span>
        <span style={{ color: "var(--text-secondary)" }}>
          Abonos: <strong style={{ color: "var(--text-primary)" }}>{monedaConCentavos.format(Number(deCentavos(abonos)))}</strong>
        </span>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Revisa que los totales cuadren con tu archivo antes de guardar. {conCategoria} de {movimientos.length} llevan
        categoría; las demás las puedes asignar en tu tablero.
      </p>

      {errores.length > 0 && (
        <details className="text-sm" style={{ color: "var(--text-secondary)" }}>
          <summary className="cursor-pointer" style={{ color: "var(--text-primary)" }}>
            ⚠ {errores.length} fila(s) no se pudieron leer y no se guardarán
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
            {errores.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-1 pr-3 text-left font-medium">Fecha</th>
              <th className="py-1 pr-3 text-left font-medium">Descripción</th>
              <th className="hidden py-1 pr-3 text-left font-medium sm:table-cell">Categoría</th>
              <th className="py-1 text-right font-medium">Monto</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((m) => (
              <tr key={m.fila} style={{ borderTop: "1px solid var(--border)", color: "var(--text-primary)" }}>
                <td className="whitespace-nowrap py-1 pr-3">{fechaCorta(m.fecha)}</td>
                <td className="py-1 pr-3">{m.descripcion}</td>
                <td className="hidden py-1 pr-3 sm:table-cell" style={{ color: "var(--text-secondary)" }}>
                  {categoriaDe(m) ?? "Sin categoría"}
                </td>
                <td
                  className="whitespace-nowrap py-1 text-right tabular-nums"
                  style={{ color: m.tipo === "abono" ? "var(--status-good)" : undefined }}
                >
                  {m.tipo === "abono" ? "+" : "−"}
                  {monedaConCentavos.format(Number(m.monto))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {movimientos.length > FILAS_VISTA_PREVIA && (
          <button
            type="button"
            className="mt-1 text-xs"
            style={{ color: "var(--marca)" }}
            onClick={() => setVerTodos((v) => !v)}
          >
            {verTodos ? "Ver menos" : `Ver los ${movimientos.length}`}
          </button>
        )}
      </div>

      {guardados ? (
        <Nota tipo="exito">
          Listo: {guardados.n} movimientos guardados en {guardados.cuenta}. Ya los ves en tu tablero.
        </Nota>
      ) : (
        <div className="space-y-2">
          <ElegirCuenta cuentas={cuentas} valor={cuenta} onCambiar={setCuenta} />
          <Boton onClick={guardar} deshabilitado={guardando || !listo}>
            {guardando ? "Guardando…" : "Guardar movimientos"}
          </Boton>
        </div>
      )}
      {error && <Nota tipo="error">{error}</Nota>}
    </div>
  );
}
