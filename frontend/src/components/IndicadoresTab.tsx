import { useMemo } from "react";
import { categoriaDe, ocultarCategorias } from "../lib/queries";
import {
  calcularFlujoSankey,
  calcularIndicadores,
  mesActual,
  MESES_MINIMOS_RECURRENTE,
  MESES_PERIODO_POR_DEFECTO,
  nombreMes,
  nombrePeriodo,
  RANGO_MESES_VACIO,
  resolverPeriodo,
  saldoDisponible,
  UMBRAL_GASTO_HORMIGA,
  VENTANA_RECURRENTES,
  type RangoMeses,
} from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { FlujoNetoChart } from "./FlujoNetoChart";
import { FlujoSankeyChart } from "./FlujoSankeyChart";

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
  /** Igual que `categoriasExcluidas`: vive en `Dashboard` para no perderse
   * al cambiar de pestaña. */
  rangoMeses: RangoMeses;
  onCambiarRangoMeses: (actualizar: Actualizador<RangoMeses>) => void;
}

export function IndicadoresTab({
  transacciones,
  categoriasExcluidas,
  onCambiarCategoriasExcluidas,
  rangoMeses,
  onCambiarRangoMeses,
}: IndicadoresTabProps) {
  // "Ocultar categorías" ya usa las transacciones sin filtrar para que un
  // toggle no desaparezca de su propia lista -- categoriasConocidas se
  // deriva de `transacciones` (todo el historial), no del periodo.
  const categoriasConocidas = useMemo(
    () => Array.from(new Set(transacciones.map(categoriaDe))).sort(),
    [transacciones]
  );

  // Opciones del filtro: los meses que tienen al menos una transacción, del
  // más reciente al más antiguo.
  const mesesConDatos = useMemo(
    () => Array.from(new Set(transacciones.map((t) => t.fecha.slice(0, 7)))).sort().reverse(),
    [transacciones]
  );
  const mesEnCurso = mesActual();

  // Un solo periodo para todo: sin filtro, los últimos 3 meses completos;
  // con filtro, exactamente los meses elegidos. Las transacciones NO se
  // recortan antes de calcular -- cada indicador toma solo los meses del
  // periodo, pero las comparaciones (periodo anterior, promedio de 12
  // meses previos, recurrentes) necesitan ver los meses de antes.
  const periodo = useMemo(() => resolverPeriodo(rangoMeses), [rangoMeses]);
  const ultimoMes = periodo.meses[periodo.meses.length - 1];

  const transaccionesContadas = useMemo(
    () => ocultarCategorias(transacciones, categoriasExcluidas),
    [transacciones, categoriasExcluidas]
  );

  const indicadores = useMemo(
    () =>
      calcularIndicadores(transaccionesContadas, saldoDisponible(transacciones, ultimoMes), periodo),
    [transaccionesContadas, transacciones, ultimoMes, periodo]
  );

  const flujoSankey = useMemo(
    () => calcularFlujoSankey(transaccionesContadas, periodo.meses),
    [transaccionesContadas, periodo]
  );

  const hayFiltro = !periodo.porDefecto;
  const unMes = periodo.meses.length === 1;
  // "agosto 2026" / "jun 2026 – ago 2026"; sin filtro, "últimos 3 meses".
  const nombreDelPeriodo = hayFiltro
    ? nombrePeriodo(periodo.meses)
    : `últimos ${MESES_PERIODO_POR_DEFECTO} meses`;
  const nombreDelAnterior = unMes
    ? nombreMes(periodo.anteriores[0])
    : hayFiltro
      ? nombrePeriodo(periodo.anteriores)
      : `los ${MESES_PERIODO_POR_DEFECTO} meses anteriores`;

  const {
    tasaAhorro,
    tasaAhorroAnterior,
    tasaAhorro12m,
    flujoNetoPromedio,
    gastoPromedio,
    gastoPromedioReferencia,
    recurrentes,
    totalRecurrenteMensual,
    hormiga,
    enAlza,
    mesesDeCobertura,
    saldoAlCierre: saldo,
  } = indicadores;

  const cambioAhorroPuntos =
    tasaAhorro !== null && tasaAhorroAnterior !== null
      ? (tasaAhorro - tasaAhorroAnterior) * 100
      : null;
  const variacionGasto =
    gastoPromedioReferencia !== null && gastoPromedioReferencia > 0
      ? (gastoPromedio - gastoPromedioReferencia) / gastoPromedioReferencia
      : null;

  function cambiarMes(campo: keyof RangoMeses, valor: string) {
    onCambiarRangoMeses((anterior) => ({ ...anterior, [campo]: valor }));
  }

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
      <div className="flex flex-wrap items-end gap-3">
        {(["desde", "hasta"] as const).map((campo) => (
          <label key={campo} className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {campo === "desde" ? "Desde" : "Hasta"}
            <select
              value={rangoMeses[campo]}
              onChange={(e) => cambiarMes(campo, e.target.value)}
              className="mt-1 block rounded-md px-3 py-2 text-sm"
              style={{
                background: "var(--page-plane)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            >
              <option value="">—</option>
              {mesesConDatos.map((mes) => (
                <option key={mes} value={mes}>
                  {nombreMes(mes)}
                  {mes === mesEnCurso ? " (en curso)" : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
        {hayFiltro && (
          <button
            onClick={() => onCambiarRangoMeses(() => RANGO_MESES_VACIO)}
            className="text-xs underline"
            style={{ color: "var(--text-muted)" }}
          >
            Quitar filtro
          </button>
        )}
      </div>

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
        {hayFiltro ? (
          <>
            Periodo: <strong>{nombreDelPeriodo}</strong>. Todos los indicadores cuentan solo esos
            meses y se comparan contra{" "}
            {unMes ? "el mes anterior" : "el periodo anterior de la misma duración"} (
            {nombreDelAnterior}).
            {periodo.meses.includes(mesEnCurso) &&
              " El mes en curso está incompleto porque sus estados de cuenta aún no llegan."}
          </>
        ) : (
          <>
            Sin filtro, los indicadores usan los últimos {MESES_PERIODO_POR_DEFECTO} meses
            completos ({nombrePeriodo(periodo.meses)}); el mes en curso no se cuenta porque sus
            estados de cuenta aún no llegan. Elige un mes en "Desde"/"Hasta" para revisarlo por
            separado.
          </>
        )}
      </p>

      <section
        className="rounded-lg p-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Tasa de ahorro, {nombreDelPeriodo}
        </div>
        <div
          className="mt-1 font-semibold"
          style={{ fontSize: 48, lineHeight: 1.1, color: "var(--text-primary)" }}
        >
          {tasaAhorro === null ? "—" : porcentaje.format(tasaAhorro)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {cambioAhorroPuntos !== null && (
            <Delta
              texto={`${cambioAhorroPuntos >= 0 ? "+" : ""}${decimal.format(cambioAhorroPuntos)} pts vs. ${nombreDelAnterior}`}
              sube={cambioAhorroPuntos >= 0}
              favorable={cambioAhorroPuntos >= 0}
            />
          )}
          <span style={{ color: "var(--text-secondary)" }}>
            12 meses hasta {nombreMes(ultimoMes, true)}:{" "}
            {tasaAhorro12m === null ? "—" : porcentaje.format(tasaAhorro12m)}
          </span>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Qué parte de lo que entra te queda después de gastar. Una referencia común es
          ahorrar al menos 10–20% de tus ingresos.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          etiqueta={
            unMes
              ? `Flujo neto de ${nombreDelPeriodo}`
              : `Flujo neto promedio mensual (${nombreDelPeriodo})`
          }
          valor={moneda.format(flujoNetoPromedio)}
          detalle={
            unMes
              ? "Lo que te sobró (o faltó) ese mes"
              : "Lo que te sobra (o falta) en un mes típico del periodo"
          }
        />
        <Tile
          etiqueta={
            unMes ? `Gasto de ${nombreDelPeriodo}` : `Gasto mensual promedio (${nombreDelPeriodo})`
          }
          valor={moneda.format(gastoPromedio)}
          delta={
            variacionGasto === null
              ? undefined
              : {
                  texto: `${variacionGasto >= 0 ? "+" : ""}${porcentaje.format(variacionGasto)} vs. tu promedio mensual previo (${moneda.format(gastoPromedioReferencia!)})`,
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
              : `${moneda.format(saldo)} de saldo al cierre de ${nombreMes(ultimoMes, true)} ÷ ${moneda.format(gastoPromedio)} de gasto mensual. Referencia: 3–6 meses de fondo de emergencia`
          }
        />
        <Tile
          etiqueta="Gastos recurrentes (por mes)"
          valor={moneda.format(totalRecurrenteMensual)}
          detalle={
            gastoPromedio > 0
              ? `${recurrentes.length} comercio(s), ${porcentaje.format(totalRecurrenteMensual / gastoPromedio)} de tu gasto mensual`
              : `${recurrentes.length} comercio(s)`
          }
        />
        <Tile
          etiqueta={`Gasto hormiga, ${nombreDelPeriodo}`}
          valor={moneda.format(hormiga.total)}
          detalle={`${hormiga.cantidad} compra(s) de menos de ${moneda.format(UMBRAL_GASTO_HORMIGA)}${
            hormiga.proporcion === null ? "" : `, ${porcentaje.format(hormiga.proporcion)} del gasto ${unMes ? "del mes" : "del periodo"}`
          }`}
        />
        <Tile
          etiqueta="Categorías gastando más de lo normal"
          valor={String(enAlza.length)}
          detalle={
            enAlza.length > 0
              ? `En total, ${moneda.format(enAlza.reduce((s, c) => s + c.diferencia, 0))}${unMes ? "" : " al mes"} más que en ${nombreDelAnterior}`
              : `Ninguna categoría gastó más que en ${nombreDelAnterior}`
          }
        />
      </div>

      <FlujoSankeyChart datos={flujoSankey} />

      <FlujoNetoChart
        datos={indicadores.serie}
        resaltados={hayFiltro ? new Set(periodo.meses) : undefined}
        titulo={
          hayFiltro
            ? `Flujo neto mensual (ingresos − gastos) hasta ${nombreMes(ultimoMes)}; resaltado: ${nombreDelPeriodo}`
            : "Flujo neto mensual (ingresos − gastos), últimos 12 meses completos"
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Tabla
          titulo={`Categorías al alza: ${nombreDelPeriodo} vs. ${nombreDelAnterior}${unMes ? "" : " (promedio mensual)"}`}
          vacio={`Ninguna categoría gastó más que en ${nombreDelAnterior}.`}
          encabezados={[
            "Categoría",
            unMes ? nombreMes(ultimoMes, true) : "Periodo",
            unMes ? nombreMes(periodo.anteriores[0], true) : "Anterior",
            "Diferencia",
          ]}
          filas={enAlza.slice(0, 8).map((c) => [
            c.categoria,
            moneda.format(c.promedioPeriodo),
            moneda.format(c.promedioAnterior),
            `+${moneda.format(c.diferencia)}`,
          ])}
        />
        <Tabla
          titulo={`Gastos recurrentes (comercios con cargo en ${MESES_MINIMOS_RECURRENTE}+ de los ${VENTANA_RECURRENTES} meses hasta ${nombreMes(ultimoMes, true)})`}
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
