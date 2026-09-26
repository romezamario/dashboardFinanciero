import { useMemo } from "react";
import {
  agruparIngresosGastosPorAnio,
  agruparIngresosGastosPorMes,
  agruparPorCategoria,
  agruparPorComercio,
  aplicarFiltros,
  categoriaDe,
  cuentaDe,
  eventoDe,
  ocultarCategorias,
  type Filtros,
} from "../lib/queries";
import {
  calcularFlujoSankey,
  calcularGastoHormiga,
  calcularIndicadores,
  categoriasEnAlza,
  enMeses,
  gastoMensualPorCategoria,
  mesActual,
  MESES_MINIMOS_RECURRENTE,
  MESES_PERIODO_POR_DEFECTO,
  mesesHasta,
  nombreMes,
  nombrePeriodo,
  RANGO_MESES_VACIO,
  rangoDeAnio,
  resolverPeriodo,
  saldoDisponible,
  UMBRAL_GASTO_HORMIGA,
  VENTANA_RECURRENTES,
  type RangoMeses,
} from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { IngresosGastosChart, type VistaTiempo } from "./IngresosGastosChart";
import { GastoPorCategoriaChart } from "./GastoPorCategoriaChart";
import { GastoPorComercioChart } from "./GastoPorComercioChart";
import { FlujoNetoChart } from "./FlujoNetoChart";
import { FlujoSankeyChart } from "./FlujoSankeyChart";
import { Sparkline } from "./Sparkline";
import { Delta, Tabla, Tile } from "./IndicadoresUI";
import { TransaccionesTabla } from "./TransaccionesTabla";
import { EditorTransacciones } from "./EditorTransacciones";

const ETIQUETAS_FILTRO: Record<keyof Filtros, string> = {
  categoria: "Categoría",
  comercio: "Comercio",
  cuenta: "Cuenta",
  tarjeta: "Tarjeta",
  evento: "Evento",
};

const moneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});
const porcentaje = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

type Actualizador<T> = (anterior: T) => T;

interface VistaResumenProps {
  /** Transacciones que esta vista muestra -- todas en "Resumen", solo las
   * de una cuenta en cada pestaña de tarjeta. */
  transacciones: Transaccion[];
  /** Todas las transacciones sin acotar, para el editor masivo (ver
   * `EditorTransacciones.catalogo`). */
  catalogo: Transaccion[];
  // Todo el estado de la vista vive en `Dashboard`, una copia por pestaña,
  // y llega aquí controlado -- así cada pestaña filtra de forma
  // independiente y no pierde su selección al cambiar de pestaña (si el
  // estado viviera aquí, desmontar la vista al cambiar de pestaña lo
  // borraría).
  filtros: Filtros;
  onCambiarFiltros: (actualizar: Actualizador<Filtros>) => void;
  categoriasOcultas: Set<string>;
  onCambiarCategoriasOcultas: (actualizar: Actualizador<Set<string>>) => void;
  rangoMeses: RangoMeses;
  onCambiarRangoMeses: (actualizar: Actualizador<RangoMeses>) => void;
  /** Agrupación de la gráfica de ingresos vs. gastos (por mes o por año). */
  vistaTiempo: VistaTiempo;
  onCambiarVistaTiempo: (vista: VistaTiempo) => void;
  onActualizado: () => void | Promise<void>;
}

/**
 * La pestaña "Resumen" (fusión del Resumen y de los Indicadores), reutilizada
 * tal cual por cada pestaña de tarjeta. Tres controles, con alcances
 * distintos a propósito:
 *
 * - **Periodo** (Desde/Hasta por mes, o clic en un mes/año de la gráfica de
 *   ingresos vs. gastos): aplica a TODO. Sin filtro, los últimos 3 meses
 *   completos.
 * - **Ocultar categorías**: aplica a TODO (por defecto oculta los
 *   movimientos entre cuentas propias, p. ej. "Pago TDC", que si no se
 *   contarían como gasto en una cuenta e ingreso en la otra).
 * - **Filtros por clic** (categoría, comercio, cuenta, tarjeta, evento):
 *   solo al detalle de gasto (gráficas, tabla, Sankey, gasto hormiga,
 *   categorías al alza). Los indicadores de salud (tasa de ahorro, flujo
 *   neto, gasto promedio, meses cubiertos, recurrentes, flujo neto mensual)
 *   siempre describen tus finanzas completas del periodo.
 */
export function VistaResumen({
  transacciones,
  catalogo,
  filtros,
  onCambiarFiltros,
  categoriasOcultas,
  onCambiarCategoriasOcultas,
  rangoMeses,
  onCambiarRangoMeses,
  vistaTiempo,
  onCambiarVistaTiempo,
  onActualizado,
}: VistaResumenProps) {
  // Todas las categorías que existen, sin importar si están ocultas -- así
  // el control de "Ocultar categorías" no pierde de vista una categoría una
  // vez que el usuario la esconde (si derivara de la lista ya filtrada,
  // ocultar la última categoría visible la haría desaparecer del propio
  // control para volver a mostrarla).
  const categoriasConocidas = useMemo(
    () => Array.from(new Set(transacciones.map(categoriaDe))).sort(),
    [transacciones]
  );

  // No hay una gráfica que impulse este filtro (a diferencia de mes/
  // categoría/comercio, que se seleccionan haciendo clic en una barra) --
  // se deriva de las transacciones sin filtrar, igual que categoriasConocidas,
  // para que la lista de cuentas no cambie según lo que ya esté filtrado.
  const cuentasConocidas = useMemo(
    () => Array.from(new Set(transacciones.map(cuentaDe))).sort(),
    [transacciones]
  );

  // `tarjeta` es opcional por diseño (solo lo asigna BanamexTdcParser para
  // estados de cuenta con tarjetas adicionales/digitales) -- la mayoría de
  // las transacciones no lo tienen, así que se descartan los null en vez
  // de mostrarlos como una opción "Sin tarjeta".
  const tarjetasConocidas = useMemo(
    () =>
      Array.from(
        new Set(transacciones.map((t) => t.tarjeta).filter((t): t is string => !!t))
      ).sort(),
    [transacciones]
  );

  // Igual que tarjeta: un evento es opcional (viajes/fiestas concretos, no
  // todas las transacciones pertenecen a uno), así que se descartan los
  // null en vez de mostrarlos como una opción "Sin evento". Asignar
  // eventos vive en su propia pestaña (EventosTab) -- este filtro solo
  // sirve para ver/cruzar por evento ya asignado en el Resumen.
  const eventosConocidos = useMemo(
    () =>
      Array.from(
        new Set(transacciones.map(eventoDe).filter((e): e is string => e !== null))
      ).sort(),
    [transacciones]
  );

  // Opciones del periodo: los meses con al menos una transacción, del más
  // reciente al más antiguo.
  const mesesConDatos = useMemo(
    () => Array.from(new Set(transacciones.map((t) => t.fecha.slice(0, 7)))).sort().reverse(),
    [transacciones]
  );
  const mesEnCurso = mesActual();

  const periodo = useMemo(() => resolverPeriodo(rangoMeses), [rangoMeses]);
  const ultimoMes = periodo.meses[periodo.meses.length - 1];
  const hayPeriodoElegido = !periodo.porDefecto;
  const unMes = periodo.meses.length === 1;
  // "agosto 2026" / "jun 2026 – ago 2026"; sin filtro, "últimos 3 meses".
  const nombreDelPeriodo = hayPeriodoElegido
    ? nombrePeriodo(periodo.meses)
    : `últimos ${MESES_PERIODO_POR_DEFECTO} meses`;
  const nombreDelAnterior = unMes
    ? nombreMes(periodo.anteriores[0])
    : hayPeriodoElegido
      ? nombrePeriodo(periodo.anteriores)
      : `los ${MESES_PERIODO_POR_DEFECTO} meses anteriores`;

  // 1) Ocultar categorías: se quitan de raíz, de todo el historial (las
  //    comparaciones contra periodos anteriores también las ignoran).
  const visibles = useMemo(
    () => ocultarCategorias(transacciones, categoriasOcultas),
    [transacciones, categoriasOcultas]
  );

  // 2) Salud financiera: periodo + categorías ocultas, SIN filtros por clic.
  const indicadores = useMemo(
    () => calcularIndicadores(visibles, saldoDisponible(transacciones, ultimoMes), periodo),
    [visibles, transacciones, ultimoMes, periodo]
  );

  // 3) Detalle de gasto: además, filtros por clic. Cada gráfica excluye su
  //    propia dimensión (cross-filter estilo Power BI) para poder seguir
  //    viendo/cambiando su selección.
  const conFiltros = useMemo(() => aplicarFiltros(visibles, filtros), [visibles, filtros]);
  const delPeriodo = useMemo(() => enMeses(visibles, periodo.meses), [visibles, periodo]);
  const transaccionesFiltradas = useMemo(
    () => aplicarFiltros(delPeriodo, filtros),
    [delPeriodo, filtros]
  );
  const gastoPorCategoria = agruparPorCategoria(aplicarFiltros(delPeriodo, filtros, "categoria"));
  const gastoPorComercio = agruparPorComercio(aplicarFiltros(delPeriodo, filtros, "comercio"));
  const flujoSankey = useMemo(
    () => calcularFlujoSankey(conFiltros, periodo.meses),
    [conFiltros, periodo]
  );
  const hormiga = useMemo(
    () => calcularGastoHormiga(conFiltros, periodo.meses),
    [conFiltros, periodo]
  );
  const enAlza = useMemo(() => categoriasEnAlza(conFiltros, periodo), [conFiltros, periodo]);
  const categoriasAlzaVisibles = useMemo(() => enAlza.slice(0, 8), [enAlza]);
  const mesesTendencia = useMemo(() => mesesHasta(ultimoMes, 12), [ultimoMes]);
  const tendencias = useMemo(
    () =>
      gastoMensualPorCategoria(
        conFiltros,
        categoriasAlzaVisibles.map((c) => c.categoria),
        mesesTendencia
      ),
    [conFiltros, categoriasAlzaVisibles, mesesTendencia]
  );

  // La gráfica de ingresos vs. gastos es la que ELIGE el periodo, así que
  // muestra todo el historial (con los filtros por clic) y resalta el
  // periodo elegido, en vez de recortarse a él.
  const ingresosGastos =
    vistaTiempo === "anios"
      ? agruparIngresosGastosPorAnio(conFiltros)
      : agruparIngresosGastosPorMes(conFiltros);
  const mesesDelPeriodo = useMemo(() => new Set(periodo.meses), [periodo]);
  const resaltadosTiempo = hayPeriodoElegido
    ? vistaTiempo === "anios"
      ? new Set(periodo.meses.map((m) => m.slice(0, 4)))
      : mesesDelPeriodo
    : undefined;

  const {
    tasaAhorro,
    tasaAhorroAnterior,
    tasaAhorro12m,
    flujoNetoPromedio,
    gastoPromedio,
    gastoPromedioReferencia,
    recurrentes,
    totalRecurrenteMensual,
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

  // Clic en la gráfica de ingresos vs. gastos: ese mes (o ese año) pasa a
  // ser el periodo; otro clic en el mismo lo quita.
  function elegirPeriodoConClic(valor: string) {
    const nuevo =
      vistaTiempo === "anios" ? rangoDeAnio(valor, mesesConDatos) : { desde: valor, hasta: valor };
    onCambiarRangoMeses((anterior) =>
      anterior.desde === nuevo.desde && anterior.hasta === nuevo.hasta ? RANGO_MESES_VACIO : nuevo
    );
  }

  function alternarFiltro<K extends keyof Filtros>(campo: K, valor: string) {
    onCambiarFiltros((anterior) =>
      anterior[campo] === valor
        ? { ...anterior, [campo]: undefined }
        : { ...anterior, [campo]: valor }
    );
  }

  function alternarCategoriaOculta(categoria: string) {
    onCambiarCategoriasOcultas((anterior) => {
      const siguiente = new Set(anterior);
      if (siguiente.has(categoria)) siguiente.delete(categoria);
      else siguiente.add(categoria);
      return siguiente;
    });
    // Evita el estado contradictorio de aislar por clic una categoría que
    // al mismo tiempo se acaba de ocultar (o viceversa).
    if (filtros.categoria === categoria) {
      onCambiarFiltros((anterior) => ({ ...anterior, categoria: undefined }));
    }
  }

  function seleccionarCategoria(categoria: string) {
    if (categoriasOcultas.has(categoria)) {
      onCambiarCategoriasOcultas((anterior) => {
        const siguiente = new Set(anterior);
        siguiente.delete(categoria);
        return siguiente;
      });
    }
    alternarFiltro("categoria", categoria);
  }

  const hayFiltrosActivos = Object.values(filtros).some(Boolean);

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
        {hayPeriodoElegido && (
          <button
            onClick={() => onCambiarRangoMeses(() => RANGO_MESES_VACIO)}
            className="text-xs underline"
            style={{ color: "var(--text-muted)" }}
          >
            Volver a los últimos {MESES_PERIODO_POR_DEFECTO} meses
          </button>
        )}
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {hayPeriodoElegido ? (
          <>
            Periodo: <strong>{nombreDelPeriodo}</strong>. Todo cuenta solo esos meses; las
            variaciones se comparan contra{" "}
            {unMes ? "el mes anterior" : "el periodo anterior de la misma duración"} (
            {nombreDelAnterior}).
            {periodo.meses.includes(mesEnCurso) &&
              " El mes en curso está incompleto porque sus estados de cuenta aún no llegan."}
          </>
        ) : (
          <>
            Periodo: <strong>últimos {MESES_PERIODO_POR_DEFECTO} meses completos</strong> (
            {nombrePeriodo(periodo.meses)}); el mes en curso no se cuenta porque sus estados de
            cuenta aún no llegan. Elige meses en "Desde"/"Hasta" o haz clic en un mes o año de
            la gráfica de ingresos vs. gastos.
          </>
        )}
      </p>

      {hayFiltrosActivos && (
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(filtros) as (keyof Filtros)[])
            .filter((campo) => filtros[campo])
            .map((campo) => (
              <button
                key={campo}
                onClick={() => onCambiarFiltros((a) => ({ ...a, [campo]: undefined }))}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  background: "var(--series-1)",
                  color: "#ffffff",
                }}
                title="Quitar este filtro"
              >
                {ETIQUETAS_FILTRO[campo]}: {filtros[campo]} ×
              </button>
            ))}
          <button
            onClick={() => onCambiarFiltros(() => ({}))}
            className="text-xs underline"
            style={{ color: "var(--text-muted)" }}
          >
            Quitar filtros por clic
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Ocultar categorías:
        </span>
        {categoriasConocidas.map((categoria) => {
          const oculta = categoriasOcultas.has(categoria);
          return (
            <button
              key={categoria}
              onClick={() => alternarCategoriaOculta(categoria)}
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{
                background: "var(--surface-1)",
                border: `1px solid ${
                  oculta ? "var(--status-critical)" : "var(--border)"
                }`,
                color: oculta ? "var(--status-critical)" : "var(--text-secondary)",
                textDecoration: oculta ? "line-through" : "none",
              }}
              title={oculta ? "Mostrar de nuevo" : "Ocultar esta categoría"}
            >
              {categoria}
            </button>
          );
        })}
        {categoriasOcultas.size > 0 && (
          <button
            onClick={() => onCambiarCategoriasOcultas(() => new Set())}
            className="text-xs underline"
            style={{ color: "var(--text-muted)" }}
          >
            Mostrar todas
          </button>
        )}
      </div>

      {cuentasConocidas.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Cuenta:
          </span>
          {cuentasConocidas.map((cuenta) => {
            const seleccionada = filtros.cuenta === cuenta;
            return (
              <button
                key={cuenta}
                onClick={() => alternarFiltro("cuenta", cuenta)}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  background: seleccionada ? "var(--series-1)" : "var(--surface-1)",
                  border: `1px solid ${
                    seleccionada ? "var(--series-1)" : "var(--border)"
                  }`,
                  color: seleccionada ? "#ffffff" : "var(--text-secondary)",
                }}
                title={seleccionada ? "Quitar este filtro" : "Filtrar por esta cuenta"}
              >
                {cuenta}
              </button>
            );
          })}
        </div>
      )}

      {tarjetasConocidas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Tarjeta:
          </span>
          {tarjetasConocidas.map((tarjeta) => {
            const seleccionada = filtros.tarjeta === tarjeta;
            return (
              <button
                key={tarjeta}
                onClick={() => alternarFiltro("tarjeta", tarjeta)}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  background: seleccionada ? "var(--series-1)" : "var(--surface-1)",
                  border: `1px solid ${
                    seleccionada ? "var(--series-1)" : "var(--border)"
                  }`,
                  color: seleccionada ? "#ffffff" : "var(--text-secondary)",
                }}
                title={seleccionada ? "Quitar este filtro" : "Filtrar por esta tarjeta"}
              >
                {tarjeta}
              </button>
            );
          })}
        </div>
      )}

      {eventosConocidos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Evento:
          </span>
          {eventosConocidos.map((evento) => {
            const seleccionado = filtros.evento === evento;
            return (
              <button
                key={evento}
                onClick={() => alternarFiltro("evento", evento)}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  background: seleccionado ? "var(--series-1)" : "var(--surface-1)",
                  border: `1px solid ${
                    seleccionado ? "var(--series-1)" : "var(--border)"
                  }`,
                  color: seleccionado ? "#ffffff" : "var(--text-secondary)",
                }}
                title={seleccionado ? "Quitar este filtro" : "Filtrar por este evento"}
              >
                {evento}
              </button>
            );
          })}
        </div>
      )}

      {hayFiltrosActivos && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Los filtros por clic afectan el detalle de gasto (gráficas, Sankey, gasto hormiga,
          categorías al alza y tabla). Tasa de ahorro, flujo neto, gasto promedio, meses
          cubiertos y recurrentes siguen mostrando tus finanzas completas del periodo.
        </p>
      )}

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
          {tasaAhorro === null
            ? "Sin ingresos en el periodo (normal en una tarjeta de crédito), así que no hay tasa de ahorro que calcular."
            : "Qué parte de lo que entra te queda después de gastar. Una referencia común es ahorrar al menos 10–20% de tus ingresos."}
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
            variacionGasto === null || gastoPromedioReferencia === null
              ? undefined
              : {
                  texto: `${variacionGasto >= 0 ? "+" : ""}${porcentaje.format(variacionGasto)} vs. tu promedio mensual previo (${moneda.format(gastoPromedioReferencia)})`,
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
            hormiga.proporcion === null
              ? ""
              : `, ${porcentaje.format(hormiga.proporcion)} del gasto ${unMes ? "del mes" : "del periodo"}`
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

      <IngresosGastosChart
        datos={ingresosGastos}
        vista={vistaTiempo}
        onCambiarVista={onCambiarVistaTiempo}
        resaltados={resaltadosTiempo}
        onClickPeriodo={elegirPeriodoConClic}
      />

      <FlujoSankeyChart datos={flujoSankey} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GastoPorCategoriaChart
          datos={gastoPorCategoria}
          categoriaSeleccionada={filtros.categoria}
          onClickCategoria={seleccionarCategoria}
        />
        <GastoPorComercioChart
          datos={gastoPorComercio}
          comercioSeleccionado={filtros.comercio}
          onClickComercio={(comercio) => alternarFiltro("comercio", comercio)}
        />
      </div>

      <FlujoNetoChart
        datos={indicadores.serie}
        resaltados={hayPeriodoElegido ? mesesDelPeriodo : undefined}
        titulo={
          hayPeriodoElegido
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
            "Tendencia 12 meses",
          ]}
          filas={categoriasAlzaVisibles.map((c) => [
            c.categoria,
            moneda.format(c.promedioPeriodo),
            moneda.format(c.promedioAnterior),
            `+${moneda.format(c.diferencia)}`,
            <Sparkline
              key="tendencia"
              valores={tendencias.get(c.categoria) ?? []}
              meses={mesesTendencia}
              resaltados={mesesDelPeriodo}
              etiqueta={c.categoria}
            />,
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

      <TransaccionesTabla transacciones={transaccionesFiltradas} />

      <EditorTransacciones
        transacciones={transacciones}
        catalogo={catalogo}
        onActualizado={onActualizado}
      />
    </>
  );
}
