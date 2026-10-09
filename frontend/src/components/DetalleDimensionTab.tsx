import { useMemo, useState } from "react";
import {
  agruparPor,
  aplicarFiltros,
  categoriaDe,
  comercioDe,
  type Filtros,
} from "../lib/queries";
import {
  gastoMensualConPromedioMovil,
  ladoDominante,
  mesesHasta,
  RANGO_MESES_VACIO,
  resolverPeriodo,
} from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { GastoConPromedioMovilChart } from "./GastoConPromedioMovilChart";
import { Tabla } from "./IndicadoresUI";
import { IngresosGastosPorDimensionChart } from "./IngresosGastosPorDimensionChart";
import { MENSAJE_SIN_COMERCIO } from "../lib/texto";
import { TransaccionesTabla } from "./TransaccionesTabla";
import { moneda, fechaCorta } from "../lib/formato";

type DimensionDetalle = "categoria" | "comercio";

const ETIQUETAS_FILTRO: Record<DimensionDetalle, string> = {
  categoria: "Categoría",
  comercio: "Comercio",
};

const TOPE_TOP_GASTOS = 10;

interface DetalleDimensionTabProps {
  transacciones: Transaccion[];
}

/**
 * Pestaña "Categorías y Comercios" (fusión de las dos pestañas que existían
 * por separado, a petición del usuario): explorar el gasto por cualquiera
 * de las dos dimensiones a la vez, en vez de tener que elegir cuál es "la"
 * dimensión de la pestaña. Los dos selects de arriba (categoría y comercio)
 * son independientes y se combinan en Y lógico, igual que el resto del
 * cross-filter del dashboard -- se puede ver, por ejemplo, cuánto se gastó
 * en "Comida" específicamente en "Walmart".
 *
 * Cross-filter local (useState propio, mismo patrón que EventosTab) sin
 * filtro de fecha/cuenta/tarjeta ni herramienta de asignación -- a
 * diferencia de evento, categoría siempre tiene un valor (SIN_CATEGORIA) y
 * comercio ya se asigna desde reglas o "Editar en lote", así que no hace
 * falta "encontrar" transacciones sin categorizar desde aquí.
 */
export function DetalleDimensionTab({ transacciones }: DetalleDimensionTabProps) {
  const [filtros, setFiltros] = useState<Filtros>({});
  // Mes ("YYYY-MM") elegido con un clic en la gráfica mensual: filtra todo lo de
  // abajo (barras por categoría/comercio, mayores gastos, tabla) a ese mes. La
  // propia gráfica mensual no se recorta (cross-filter: excluye su dimensión).
  const [mes, setMes] = useState<string | null>(null);
  const alternarMes = (valor: string) => setMes((anterior) => (anterior === valor ? null : valor));

  // Al cambiar de categoría, un comercio ya elegido que no tiene movimientos
  // en la nueva categoría se quita: el select de comercio solo ofrece los de
  // la categoría elegida, y dejarlo dejaría una combinación vacía.
  function conCategoria(anterior: Filtros, categoria: string | undefined): Filtros {
    const comercio =
      categoria && anterior.comercio && !comerciosDeCategoria(categoria).includes(anterior.comercio)
        ? undefined
        : anterior.comercio;
    return { ...anterior, categoria, comercio };
  }

  function alternarFiltro(campo: DimensionDetalle, valor: string) {
    setFiltros((anterior) => {
      const nuevo = anterior[campo] === valor ? undefined : valor;
      return campo === "categoria" ? conCategoria(anterior, nuevo) : { ...anterior, [campo]: nuevo };
    });
  }

  // Los selects de arriba fijan el valor directo (a diferencia del clic en
  // una barra, que alterna/quita) -- elegir "(todas)" limpia ese filtro.
  function elegirFiltro(campo: DimensionDetalle, valor: string) {
    setFiltros((anterior) =>
      campo === "categoria"
        ? conCategoria(anterior, valor || undefined)
        : { ...anterior, [campo]: valor || undefined }
    );
  }

  // Opciones de los selects -- se derivan de TODAS las transacciones de la
  // pestaña (no de `transaccionesFiltradas`), para que la lista de opciones
  // no cambie según lo que ya esté filtrado. Excepción: con una categoría
  // elegida, el select de comercio solo ofrece los comercios de esa
  // categoría (petición del usuario, 2026-10-03).
  const categoriasConocidas = useMemo(
    () => Array.from(new Set(transacciones.map(categoriaDe))).sort(),
    [transacciones]
  );
  function comerciosDeCategoria(categoria: string | undefined): string[] {
    return Array.from(
      new Set(
        transacciones
          .filter((t) => !categoria || categoriaDe(t) === categoria)
          .map((t) => t.comercio)
          .filter((c): c is string => !!c)
      )
    ).sort();
  }
  const comerciosConocidos = useMemo(
    () => comerciosDeCategoria(filtros.categoria),
    // comerciosDeCategoria solo lee `transacciones`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transacciones, filtros.categoria]
  );

  // Periodo fijo (últimos 3 meses completos) solo para la ventana de 12
  // meses de la gráfica de promedio móvil -- a diferencia del Resumen, esta
  // pestaña no tiene su propio selector Desde/Hasta.
  const periodo = useMemo(() => resolverPeriodo(RANGO_MESES_VACIO), []);
  const ultimoMes = periodo.meses[periodo.meses.length - 1];
  const mesesTendencia = useMemo(() => mesesHasta(ultimoMes, 12), [ultimoMes]);

  const transaccionesDelMes = useMemo(
    () => (mes ? transacciones.filter((t) => t.fecha.startsWith(mes)) : transacciones),
    [transacciones, mes]
  );
  const gastoPorCategoria = useMemo(
    () => agruparPor(aplicarFiltros(transaccionesDelMes, filtros, "categoria"), categoriaDe),
    [transaccionesDelMes, filtros]
  );
  const gastoPorComercio = useMemo(
    () => agruparPor(aplicarFiltros(transaccionesDelMes, filtros, "comercio"), comercioDe),
    [transaccionesDelMes, filtros]
  );
  // Sin el filtro de mes: es lo que grafica la gráfica mensual (que resalta el
  // mes elegido en vez de recortarse a él) y lo que decide ingreso vs. gasto.
  const transaccionesSinMes = useMemo(
    () => aplicarFiltros(transacciones, filtros),
    [transacciones, filtros]
  );
  const transaccionesFiltradas = useMemo(
    () => aplicarFiltros(transaccionesDelMes, filtros),
    [transaccionesDelMes, filtros]
  );
  // Una selección de puros abonos (ej. "Transferencia recibida") se grafica y
  // lista como ingreso -- ver ladoDominante.
  const lado = useMemo(() => ladoDominante(transaccionesSinMes), [transaccionesSinMes]);
  const esIngreso = lado === "ingreso";
  const topGastos = useMemo(
    () =>
      transaccionesFiltradas
        .filter((t) => t.tipo === (esIngreso ? "abono" : "cargo"))
        .sort((a, b) => b.monto - a.monto)
        .slice(0, TOPE_TOP_GASTOS),
    [transaccionesFiltradas, esIngreso]
  );

  // Siempre visible: gasto total (sin selección), de un elemento puntual, o
  // de la intersección de ambos ("Comida" en "Walmart") si se eligen los
  // dos a la vez, con su promedio móvil de 3 meses.
  const seleccionActual =
    filtros.categoria && filtros.comercio
      ? `${filtros.categoria} en ${filtros.comercio}`
      : (filtros.categoria ?? filtros.comercio ?? null);
  const tendenciaConPromedioMovil = useMemo(
    () => gastoMensualConPromedioMovil(transaccionesSinMes, mesesTendencia, 3, lado),
    [transaccionesSinMes, mesesTendencia, lado]
  );

  const hayFiltrosActivos = Boolean(filtros.categoria || filtros.comercio || mes);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-full text-xs sm:w-auto" style={{ color: "var(--text-secondary)" }}>
          Filtrar por categoría
          <select
            value={filtros.categoria ?? ""}
            onChange={(e) => elegirFiltro("categoria", e.target.value)}
            className="mt-1 block w-full rounded-md px-3 py-2 text-sm sm:w-56"
            style={{
              background: "var(--page-plane)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          >
            <option value="">(todas)</option>
            {categoriasConocidas.map((nombre) => (
              <option key={nombre} value={nombre}>
                {nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="w-full text-xs sm:w-auto" style={{ color: "var(--text-secondary)" }}>
          Filtrar por comercio
          <select
            value={filtros.comercio ?? ""}
            onChange={(e) => elegirFiltro("comercio", e.target.value)}
            className="mt-1 block w-full rounded-md px-3 py-2 text-sm sm:w-56"
            style={{
              background: "var(--page-plane)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          >
            <option value="">(todas)</option>
            {comerciosConocidos.map((nombre) => (
              <option key={nombre} value={nombre}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

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
          {mes && (
            <button
              onClick={() => setMes(null)}
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: "var(--series-1)", color: "#ffffff" }}
              title="Quitar este filtro"
            >
              Mes: {mes} ×
            </button>
          )}
          <button
            onClick={() => {
              setFiltros({});
              setMes(null);
            }}
            className="text-xs underline"
            style={{ color: "var(--text-muted)" }}
          >
            Limpiar todos los filtros
          </button>
        </div>
      )}

      <GastoConPromedioMovilChart
        datos={tendenciaConPromedioMovil}
        lado={lado}
        mesSeleccionado={mes ?? undefined}
        onClickMes={alternarMes}
        titulo={`${esIngreso ? "Ingreso" : "Gasto"} mensual y promedio móvil${
          seleccionActual ? ` de "${seleccionActual}"` : ""
        }`}
      />

      <IngresosGastosPorDimensionChart
        dimension="categoría"
        plegarResto
        datos={gastoPorCategoria}
        seleccionado={filtros.categoria}
        onClickElemento={(categoria) => alternarFiltro("categoria", categoria)}
      />
      <IngresosGastosPorDimensionChart
        dimension="comercio"
        mensajeVacio={MENSAJE_SIN_COMERCIO}
        datos={gastoPorComercio}
        seleccionado={filtros.comercio}
        onClickElemento={(comercio) => alternarFiltro("comercio", comercio)}
      />

      <Tabla
        titulo={`${esIngreso ? "Ingresos" : "Gastos"} individuales más grandes (según lo filtrado arriba${mes ? `, ${mes}` : ""})`}
        vacio={`No hay ${esIngreso ? "ingresos" : "gastos"} en la selección actual.`}
        encabezados={["Descripción", "Fecha", "Monto"]}
        filas={topGastos.map((t) => [
          t.descripcion,
          fechaCorta(t.fecha),
          moneda.format(t.monto),
        ])}
      />

      <TransaccionesTabla transacciones={transaccionesFiltradas} />
    </div>
  );
}
