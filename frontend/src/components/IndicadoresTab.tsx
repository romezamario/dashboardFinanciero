import { useMemo } from "react";
import { categoriaDe, ocultarCategorias } from "../lib/queries";
import {
  calcularIndicadores,
  MESES_MINIMOS_RECURRENTE,
  saldoDisponible,
  UMBRAL_GASTO_HORMIGA,
  VENTANA_RECURRENTES,
} from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { FlujoNetoChart } from "./FlujoNetoChart";

const moneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});
const porcentaje = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

type Actualizador<T> = (anterior: T) => T;

interface IndicadoresTabProps {
  transacciones: Transaccion[];
  /** Categorías que no cuentan como ingreso/gasto real (p. ej. pagos a la
   * TDC desde otra cuenta propia). Vive en `Dashboard` para no perderse al
   * cambiar de pestaña. */
  categoriasExcluidas: Set<string>;
  onCambiarCategoriasExcluidas: (actualizar: Actualizador<Set<string>>) => void;
}

export function IndicadoresTab({
  transacciones,
  categoriasExcluidas,
  onCambiarCategoriasExcluidas,
}: IndicadoresTabProps) {
  const categoriasConocidas = useMemo(
    () => Array.from(new Set(transacciones.map(categoriaDe))).sort(),
    [transacciones]
  );

  const indicadores = useMemo(
    () =>
      calcularIndicadores(
        ocultarCategorias(transacciones, categoriasExcluidas),
        saldoDisponible(transacciones)
      ),
    [transacciones, categoriasExcluidas]
  );

  const {
    tasaAhorro3m,
    tasaAhorro3mAnterior,
    tasaAhorro12m,
    flujoNetoPromedio3m,
    gastoUltimoMes,
    gastoPromedio12m,
    mesUltimo,
    recurrentes,
    totalRecurrenteMensual,
    hormiga,
    enAlza,
    mesesDeCobertura,
    saldoDisponible: saldo,
  } = indicadores;

  const cambioAhorroPuntos =
    tasaAhorro3m !== null && tasaAhorro3mAnterior !== null
      ? (tasaAhorro3m - tasaAhorro3mAnterior) * 100
      : null;
  const variacionGasto =
    gastoPromedio12m > 0 ? (gastoUltimoMes - gastoPromedio12m) / gastoPromedio12m : null;
  const gastoPromedio3m = indicadores.meses.slice(-3).reduce((s, m) => s + m.gastos, 0) / 3;

  function alternarExcluida(categoria: string) {
    onCambiarCategoriasExcluidas((anterior) => {
      const siguiente = new Set(anterior);
      if (siguiente.has(categoria)) siguiente.delete(categoria);
      else siguiente.add(categoria);
      return siguiente;
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          No contar como ingreso/gasto (movimientos entre tus cuentas):
        </span>
        {categoriasConocidas.map((categoria) => {
          const excluida = categoriasExcluidas.has(categoria);
          return (
            <button
              key={categoria}
              onClick={() => alternarExcluida(categoria)}
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{
                background: "var(--surface-1)",
                border: `1px solid ${excluida ? "var(--status-critical)" : "var(--border)"}`,
                color: excluida ? "var(--status-critical)" : "var(--text-secondary)",
                textDecoration: excluida ? "line-through" : "none",
              }}
              title={excluida ? "Volver a contar" : "Excluir de los indicadores"}
            >
              {categoria}
            </button>
          );
        })}
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Todos los indicadores usan meses completos (el último es {mesUltimo}); el mes en curso
        no se cuenta porque sus estados de cuenta aún no llegan.
      </p>

      <section
        className="rounded-lg p-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Tasa de ahorro, últimos 3 meses
        </div>
        <div
          className="mt-1 font-semibold"
          style={{ fontSize: 48, lineHeight: 1.1, color: "var(--text-primary)" }}
        >
          {tasaAhorro3m === null ? "—" : porcentaje.format(tasaAhorro3m)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {cambioAhorroPuntos !== null && (
            <Delta
              texto={`${cambioAhorroPuntos >= 0 ? "+" : ""}${decimal.format(cambioAhorroPuntos)} pts vs. los 3 meses anteriores`}
              sube={cambioAhorroPuntos >= 0}
              favorable={cambioAhorroPuntos >= 0}
            />
          )}
          <span style={{ color: "var(--text-secondary)" }}>
            12 meses: {tasaAhorro12m === null ? "—" : porcentaje.format(tasaAhorro12m)}
          </span>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Qué parte de lo que entra te queda después de gastar. Una referencia común es
          ahorrar al menos 10–20% de tus ingresos.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          etiqueta="Flujo neto promedio (3 meses)"
          valor={moneda.format(flujoNetoPromedio3m)}
          detalle="Lo que te sobra (o falta) en un mes típico"
        />
        <Tile
          etiqueta={`Gasto de ${mesUltimo}`}
          valor={moneda.format(gastoUltimoMes)}
          delta={
            variacionGasto === null
              ? undefined
              : {
                  texto: `${variacionGasto >= 0 ? "+" : ""}${porcentaje.format(variacionGasto)} vs. promedio 12 meses (${moneda.format(gastoPromedio12m)})`,
                  sube: variacionGasto > 0,
                  favorable: variacionGasto <= 0,
                }
          }
        />
        <Tile
          etiqueta="Meses cubiertos con tu saldo"
          valor={mesesDeCobertura === null ? "—" : `${decimal.format(mesesDeCobertura)} meses`}
          detalle={
            saldo === null
              ? "Sin cuentas de débito con saldo"
              : `${moneda.format(saldo)} de saldo ÷ ${moneda.format(gastoPromedio3m)} de gasto mensual. Referencia: 3–6 meses de fondo de emergencia`
          }
        />
        <Tile
          etiqueta="Gastos recurrentes (por mes)"
          valor={moneda.format(totalRecurrenteMensual)}
          detalle={
            gastoPromedio3m > 0
              ? `${recurrentes.length} comercio(s), ${porcentaje.format(totalRecurrenteMensual / gastoPromedio3m)} de tu gasto mensual`
              : `${recurrentes.length} comercio(s)`
          }
        />
        <Tile
          etiqueta={`Gasto hormiga en ${mesUltimo}`}
          valor={moneda.format(hormiga.total)}
          detalle={`${hormiga.cantidad} compra(s) de menos de ${moneda.format(UMBRAL_GASTO_HORMIGA)}${
            hormiga.proporcion === null ? "" : `, ${porcentaje.format(hormiga.proporcion)} del gasto del mes`
          }`}
        />
        <Tile
          etiqueta="Categorías gastando más de lo normal"
          valor={String(enAlza.length)}
          detalle={
            enAlza.length > 0
              ? `En total, ${moneda.format(enAlza.reduce((s, c) => s + c.diferencia, 0))} arriba de su promedio`
              : "Ninguna categoría arriba de su promedio"
          }
        />
      </div>

      <FlujoNetoChart datos={indicadores.meses} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Tabla
          titulo={`Categorías al alza en ${mesUltimo} (vs. promedio de los 3 meses anteriores)`}
          vacio="Ninguna categoría gastó más que su promedio."
          encabezados={["Categoría", mesUltimo, "Promedio", "Diferencia"]}
          filas={enAlza.slice(0, 8).map((c) => [
            c.categoria,
            moneda.format(c.ultimoMes),
            moneda.format(c.promedioAnterior),
            `+${moneda.format(c.diferencia)}`,
          ])}
        />
        <Tabla
          titulo={`Gastos recurrentes (comercios con cargo en ${MESES_MINIMOS_RECURRENTE}+ de los últimos ${VENTANA_RECURRENTES} meses)`}
          vacio="No se detectaron gastos recurrentes. Solo se detectan comercios que tus reglas de categorización ya etiquetan."
          encabezados={["Comercio", "Meses", "Promedio mensual"]}
          filas={recurrentes.map((r) => [
            r.comercio,
            `${r.mesesPresente} de ${VENTANA_RECURRENTES}`,
            moneda.format(r.montoMensual),
          ])}
        />
      </div>
    </>
  );
}

interface PropsDelta {
  texto: string;
  /** Dirección del cambio (flecha), independiente de si es bueno o malo:
   * más gasto sube (▲) aunque sea desfavorable. */
  sube: boolean;
  /** Favorable/desfavorable (color). */
  favorable: boolean;
}

function Delta({ texto, sube, favorable }: PropsDelta) {
  // El color de estado nunca va solo: flecha + texto cargan el significado.
  return (
    <span style={{ color: favorable ? "var(--status-good)" : "var(--status-critical)" }}>
      {sube ? "▲" : "▼"} {texto}
    </span>
  );
}

function Tile({
  etiqueta,
  valor,
  detalle,
  delta,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  delta?: PropsDelta;
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {etiqueta}
      </div>
      <div className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {valor}
      </div>
      {delta && (
        <div className="mt-1 text-xs">
          <Delta {...delta} />
        </div>
      )}
      {detalle && (
        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {detalle}
        </div>
      )}
    </div>
  );
}

function Tabla({
  titulo,
  vacio,
  encabezados,
  filas,
}: {
  titulo: string;
  vacio: string;
  encabezados: string[];
  filas: string[][];
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {titulo}
      </h3>
      {filas.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {vacio}
        </p>
      ) : (
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                {encabezados.map((e, i) => (
                  <th
                    key={e}
                    className={`py-2 font-medium ${i === 0 ? "text-left" : "text-right"}`}
                    style={{ color: "var(--text-muted)" }}
                  >
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila[0]} style={{ borderBottom: "1px solid var(--gridline)" }}>
                  {fila.map((celda, i) => (
                    <td
                      key={i}
                      className={`py-2 ${i === 0 ? "text-left" : "text-right"}`}
                      style={{
                        color: i === 0 ? "var(--text-primary)" : "var(--text-secondary)",
                        fontVariantNumeric: i === 0 ? undefined : "tabular-nums",
                      }}
                    >
                      {celda}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
