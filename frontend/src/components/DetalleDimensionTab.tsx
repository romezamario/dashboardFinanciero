import { useMemo, useState } from "react";
import {
  agruparPorCategoria,
  agruparPorComercio,
  aplicarFiltros,
  categoriaDe,
  type Filtros,
} from "../lib/queries";
import {
  categoriasEnAlza,
  comerciosEnAlza,
  gastoMensualConPromedioMovil,
  gastoMensualPorCategoria,
  gastoMensualPorComercio,
  mesesHasta,
  RANGO_MESES_VACIO,
  resolverPeriodo,
} from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { GastoConPromedioMovilChart } from "./GastoConPromedioMovilChart";
import { GastoPorCategoriaChart } from "./GastoPorCategoriaChart";
import { GastoPorComercioChart } from "./GastoPorComercioChart";
import { Sparkline } from "./Sparkline";
import { Tabla } from "./IndicadoresUI";
import { TransaccionesTabla } from "./TransaccionesTabla";

const moneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});
const formateadorFecha = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

type DimensionDetalle = "categoria" | "comercio";

const ETIQUETAS_FILTRO: Record<DimensionDetalle, string> = {
  categoria: "Categoría",
  comercio: "Comercio",
};

/** Cuántos elementos se muestran en la tabla "en alza" -- más que los 8 del
 * Resumen porque aquí es LA pestaña dedicada a esta dimensión, no un
 * indicador entre muchos otros. */
const TOPE_EN_ALZA = 15;
const TOPE_TOP_GASTOS = 10;

interface DetalleDimensionTabProps {
  transacciones: Transaccion[];
  /** Cuál de las dos gráficas va primero -- el cross-filter funciona igual
   * en ambos sentidos (clic en cualquiera de las dos aísla esa categoría/
   * comercio en la otra y en la tabla), esto solo decide cuál se presenta
   * como "la" dimensión de la pestaña. */
  dimensionPrincipal: DimensionDetalle;
}

/**
 * Comparte implementación entre las pestañas "Categorías" y "Comercios":
 * ambas son la misma vista, solo cambia cuál gráfica/dimensión se
 * presenta primero. Pensada para EXPLORAR una dimensión (a diferencia del
 * Resumen, que mira las finanzas completas): qué está subiendo
 * recientemente ("en alza"), cómo se ve un elemento puntual a lo largo
 * del tiempo (clic para ver su tendencia mensual/anual), y cuáles son los
 * gastos individuales más grandes dentro de lo que esté filtrado.
 *
 * Cross-filter local (useState propio, mismo patrón que EventosTab) sin
 * filtro de fecha/cuenta/tarjeta ni herramienta de asignación -- a
 * diferencia de evento, categoría siempre tiene un valor (SIN_CATEGORIA) y
 * comercio ya se asigna desde reglas o "Editar en lote", así que no hace
 * falta "encontrar" transacciones sin categorizar desde aquí.
 */
export function DetalleDimensionTab({ transacciones, dimensionPrincipal }: DetalleDimensionTabProps) {
  const [filtros, setFiltros] = useState<Filtros>({});

  function alternarFiltro(campo: DimensionDetalle, valor: string) {
    setFiltros((anterior) =>
      anterior[campo] === valor ? { ...anterior, [campo]: undefined } : { ...anterior, [campo]: valor }
    );
  }

  // El select de arriba fija el valor directo (a diferencia del clic en una
  // barra, que alterna/quita) -- elegir "(todas)" limpia el filtro.
  function elegirFiltroPrincipal(valor: string) {
    setFiltros((anterior) => ({ ...anterior, [dimensionPrincipal]: valor || undefined }));
  }

  // Opciones del select "Filtrar por categoría/comercio" -- se derivan de
  // TODAS las transacciones de la pestaña (no de `transaccionesFiltradas`),
  // para que la lista de opciones no cambie según lo que ya esté filtrado.
  const nombresConocidos = useMemo(() => {
    if (dimensionPrincipal === "categoria") {
      return Array.from(new Set(transacciones.map(categoriaDe))).sort();
    }
    return Array.from(
      new Set(transacciones.map((t) => t.comercio).filter((c): c is string => !!c))
    ).sort();
  }, [transacciones, dimensionPrincipal]);

  // Periodo fijo (últimos 3 meses completos) para "en alza" -- a diferencia
  // del Resumen, esta pestaña no tiene su propio selector Desde/Hasta; si
  // hace falta elegir otro periodo más adelante, se agrega aquí.
  const periodo = useMemo(() => resolverPeriodo(RANGO_MESES_VACIO), []);
  const ultimoMes = periodo.meses[periodo.meses.length - 1];
  const mesesTendencia = useMemo(() => mesesHasta(ultimoMes, 12), [ultimoMes]);
  const mesesDelPeriodo = useMemo(() => new Set(periodo.meses), [periodo]);

  // Se normaliza a `nombre` (en vez de `categoria`/`comercio`) para que el
  // resto del cálculo (tope, tendencias, filas de la tabla) sea el mismo
  // código sin importar la dimensión.
  const enAlza = useMemo(() => {
    if (dimensionPrincipal === "categoria") {
      return categoriasEnAlza(transacciones, periodo).map((c) => ({ nombre: c.categoria, ...c }));
    }
    return comerciosEnAlza(transacciones, periodo).map((c) => ({ nombre: c.comercio, ...c }));
  }, [transacciones, periodo, dimensionPrincipal]);
  const enAlzaVisibles = enAlza.slice(0, TOPE_EN_ALZA);
  const tendenciasEnAlza = useMemo(() => {
    const nombres = enAlzaVisibles.map((c) => c.nombre);
    return dimensionPrincipal === "categoria"
      ? gastoMensualPorCategoria(transacciones, nombres, mesesTendencia)
      : gastoMensualPorComercio(transacciones, nombres, mesesTendencia);
  }, [transacciones, enAlzaVisibles, mesesTendencia, dimensionPrincipal]);

  const gastoPorCategoria = useMemo(
    () => agruparPorCategoria(aplicarFiltros(transacciones, filtros, "categoria")),
    [transacciones, filtros]
  );
  const gastoPorComercio = useMemo(
    () => agruparPorComercio(aplicarFiltros(transacciones, filtros, "comercio")),
    [transacciones, filtros]
  );
  const transaccionesFiltradas = useMemo(
    () => aplicarFiltros(transacciones, filtros),
    [transacciones, filtros]
  );
  const topGastos = useMemo(
    () =>
      transaccionesFiltradas
        .filter((t) => t.tipo === "cargo")
        .sort((a, b) => b.monto - a.monto)
        .slice(0, TOPE_TOP_GASTOS),
    [transaccionesFiltradas]
  );

  // La tendencia de gasto + promedio móvil solo tiene sentido para UN
  // elemento puntual (categoría o comercio elegido) -- sin selección sería
  // el gasto total, que ya muestra el Resumen. Reutiliza la misma ventana
  // de 12 meses que las minigráficas de "en alza" arriba.
  const seleccionActual = filtros.categoria ?? filtros.comercio ?? null;
  const transaccionesSeleccion = useMemo(
    () => (seleccionActual ? transaccionesFiltradas : []),
    [transaccionesFiltradas, seleccionActual]
  );
  const tendenciaConPromedioMovil = useMemo(
    () => gastoMensualConPromedioMovil(transaccionesSeleccion, mesesTendencia),
    [transaccionesSeleccion, mesesTendencia]
  );

  const hayFiltrosActivos = Boolean(filtros.categoria || filtros.comercio);

  const graficaCategoria = (
    <GastoPorCategoriaChart
      datos={gastoPorCategoria}
      categoriaSeleccionada={filtros.categoria}
      onClickCategoria={(categoria) => alternarFiltro("categoria", categoria)}
    />
  );
  const graficaComercio = (
    <GastoPorComercioChart
      datos={gastoPorComercio}
      comercioSeleccionado={filtros.comercio}
      onClickComercio={(comercio) => alternarFiltro("comercio", comercio)}
    />
  );

  return (
    <div className="space-y-4">
      <label className="w-full text-xs sm:w-auto" style={{ color: "var(--text-secondary)" }}>
        Filtrar por {dimensionPrincipal === "categoria" ? "categoría" : "comercio"}
        <select
          value={filtros[dimensionPrincipal] ?? ""}
          onChange={(e) => elegirFiltroPrincipal(e.target.value)}
          className="mt-1 block w-full rounded-md px-3 py-2 text-sm sm:w-56"
          style={{
            background: "var(--page-plane)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">(todas)</option>
          {nombresConocidos.map((nombre) => (
            <option key={nombre} value={nombre}>
              {nombre}
            </option>
          ))}
        </select>
      </label>

      {hayFiltrosActivos && (
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(ETIQUETAS_FILTRO) as DimensionDetalle[])
            .filter((campo) => filtros[campo])
            .map((campo) => (
              <button
                key={campo}
                onClick={() => setFiltros((a) => ({ ...a, [campo]: undefined }))}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: "var(--series-1)", color: "#ffffff" }}
                title="Quitar este filtro"
              >
                {ETIQUETAS_FILTRO[campo]}: {filtros[campo]} ×
              </button>
            ))}
          <button
            onClick={() => setFiltros({})}
            className="text-xs underline"
            style={{ color: "var(--text-muted)" }}
          >
            Limpiar todos los filtros
          </button>
        </div>
      )}

      <Tabla
        titulo={`${dimensionPrincipal === "categoria" ? "Categorías" : "Comercios"} en alza (últimos 3 meses vs. los 3 anteriores)`}
        vacio="Nada subió respecto al periodo anterior."
        encabezados={["Nombre", "Promedio reciente", "Promedio anterior", "Diferencia", "Tendencia 12 meses"]}
        filas={enAlzaVisibles.map((c) => [
          c.nombre,
          moneda.format(c.promedioPeriodo),
          moneda.format(c.promedioAnterior),
          `+${moneda.format(c.diferencia)}`,
          <Sparkline
            key="tendencia"
            valores={tendenciasEnAlza.get(c.nombre) ?? []}
            meses={mesesTendencia}
            resaltados={mesesDelPeriodo}
            etiqueta={c.nombre}
          />,
        ])}
      />

      {dimensionPrincipal === "categoria" ? graficaCategoria : graficaComercio}
      {dimensionPrincipal === "categoria" ? graficaComercio : graficaCategoria}

      {seleccionActual && (
        <GastoConPromedioMovilChart
          datos={tendenciaConPromedioMovil}
          titulo={`Gasto mensual y promedio móvil de "${seleccionActual}"`}
        />
      )}

      <Tabla
        titulo="Gastos individuales más grandes (según lo filtrado arriba)"
        vacio="No hay gastos en la selección actual."
        encabezados={["Descripción", "Fecha", "Monto"]}
        filas={topGastos.map((t) => [
          t.descripcion,
          formateadorFecha.format(new Date(`${t.fecha}T00:00:00`)),
          moneda.format(t.monto),
        ])}
      />

      <TransaccionesTabla transacciones={transaccionesFiltradas} />
    </div>
  );
}
