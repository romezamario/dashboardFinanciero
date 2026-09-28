import { useMemo, useState } from "react";
import { agruparPorCategoria, agruparPorComercio, aplicarFiltros, type Filtros } from "../lib/queries";
import type { Transaccion } from "../lib/types";
import { GastoPorCategoriaChart } from "./GastoPorCategoriaChart";
import { GastoPorComercioChart } from "./GastoPorComercioChart";
import { TransaccionesTabla } from "./TransaccionesTabla";

type DimensionDetalle = "categoria" | "comercio";

const ETIQUETAS_FILTRO: Record<DimensionDetalle, string> = {
  categoria: "Categoría",
  comercio: "Comercio",
};

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
 * ambas son la misma vista (dos gráficas cross-filtradas + tabla de
 * transacciones), solo cambia cuál gráfica se muestra primero. Mismo
 * patrón de cross-filter local que EventosTab (useState propio, no el
 * `filtros` de VistaResumen) y, a diferencia de esa pestaña, sin filtro de
 * fecha/cuenta/tarjeta ni herramienta de asignación -- aquí no hace falta
 * "encontrar" transacciones sin categoría/comercio (categoría siempre
 * tiene un valor vía SIN_CATEGORIA, y comercio se asigna con reglas o
 * desde "Editar en lote", no desde aquí).
 */
export function DetalleDimensionTab({ transacciones, dimensionPrincipal }: DetalleDimensionTabProps) {
  const [filtros, setFiltros] = useState<Filtros>({});

  function alternarFiltro(campo: DimensionDetalle, valor: string) {
    setFiltros((anterior) =>
      anterior[campo] === valor ? { ...anterior, [campo]: undefined } : { ...anterior, [campo]: valor }
    );
  }

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

      {dimensionPrincipal === "categoria" ? graficaCategoria : graficaComercio}
      {dimensionPrincipal === "categoria" ? graficaComercio : graficaCategoria}

      <TransaccionesTabla transacciones={transaccionesFiltradas} />
    </div>
  );
}
