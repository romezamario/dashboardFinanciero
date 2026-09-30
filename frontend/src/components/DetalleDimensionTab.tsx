import { useMemo, useState } from "react";
import {
  agruparPorCategoria,
  agruparPorComercio,
  aplicarFiltros,
  categoriaDe,
  type Filtros,
} from "../lib/queries";
import {
  gastoMensualConPromedioMovil,
  mesesHasta,
  RANGO_MESES_VACIO,
  resolverPeriodo,
} from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { GastoConPromedioMovilChart } from "./GastoConPromedioMovilChart";
import { GastoPorCategoriaChart } from "./GastoPorCategoriaChart";
import { GastoPorComercioChart } from "./GastoPorComercioChart";
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

  function alternarFiltro(campo: DimensionDetalle, valor: string) {
    setFiltros((anterior) =>
      anterior[campo] === valor ? { ...anterior, [campo]: undefined } : { ...anterior, [campo]: valor }
    );
  }

  // Los selects de arriba fijan el valor directo (a diferencia del clic en
  // una barra, que alterna/quita) -- elegir "(todas)" limpia ese filtro.
  function elegirFiltro(campo: DimensionDetalle, valor: string) {
    setFiltros((anterior) => ({ ...anterior, [campo]: valor || undefined }));
  }

  // Opciones de los selects -- se derivan de TODAS las transacciones de la
  // pestaña (no de `transaccionesFiltradas`), para que la lista de opciones
  // no cambie según lo que ya esté filtrado.
  const categoriasConocidas = useMemo(
    () => Array.from(new Set(transacciones.map(categoriaDe))).sort(),
    [transacciones]
  );
  const comerciosConocidos = useMemo(
    () =>
      Array.from(
        new Set(transacciones.map((t) => t.comercio).filter((c): c is string => !!c))
      ).sort(),
    [transacciones]
  );

  // Periodo fijo (últimos 3 meses completos) solo para la ventana de 12
  // meses de la gráfica de promedio móvil -- a diferencia del Resumen, esta
  // pestaña no tiene su propio selector Desde/Hasta.
  const periodo = useMemo(() => resolverPeriodo(RANGO_MESES_VACIO), []);
  const ultimoMes = periodo.meses[periodo.meses.length - 1];
  const mesesTendencia = useMemo(() => mesesHasta(ultimoMes, 12), [ultimoMes]);

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

  // Siempre visible: gasto total (sin selección), de un elemento puntual, o
  // de la intersección de ambos ("Comida" en "Walmart") si se eligen los
  // dos a la vez, con su promedio móvil de 3 meses.
  const seleccionActual =
    filtros.categoria && filtros.comercio
      ? `${filtros.categoria} en ${filtros.comercio}`
      : (filtros.categoria ?? filtros.comercio ?? null);
  const tendenciaConPromedioMovil = useMemo(
    () => gastoMensualConPromedioMovil(transaccionesFiltradas, mesesTendencia),
    [transaccionesFiltradas, mesesTendencia]
  );

  const hayFiltrosActivos = Boolean(filtros.categoria || filtros.comercio);

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
          <button
            onClick={() => setFiltros({})}
            className="text-xs underline"
            style={{ color: "var(--text-muted)" }}
          >
            Limpiar todos los filtros
          </button>
        </div>
      )}

      <GastoConPromedioMovilChart
        datos={tendenciaConPromedioMovil}
        titulo={
          seleccionActual
            ? `Gasto mensual y promedio móvil de "${seleccionActual}"`
            : "Gasto mensual y promedio móvil"
        }
      />

      <GastoPorCategoriaChart
        datos={gastoPorCategoria}
        categoriaSeleccionada={filtros.categoria}
        onClickCategoria={(categoria) => alternarFiltro("categoria", categoria)}
      />
      <GastoPorComercioChart
        datos={gastoPorComercio}
        comercioSeleccionado={filtros.comercio}
        onClickComercio={(comercio) => alternarFiltro("comercio", comercio)}
      />

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
