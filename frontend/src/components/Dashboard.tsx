import { useEffect, useState } from "react";
import {
  agruparGastoPorCategoria,
  agruparGastoPorComercio,
  agruparIngresosGastosPorMes,
  aplicarFiltros,
  calcularTotales,
  obtenerTransacciones,
  type Filtros,
} from "../lib/queries";
import type { Transaccion } from "../lib/types";
import { supabase } from "../lib/supabase";
import { StatTile } from "./StatTile";
import { IngresosGastosChart } from "./IngresosGastosChart";
import { GastoPorCategoriaChart } from "./GastoPorCategoriaChart";
import { GastoPorComercioChart } from "./GastoPorComercioChart";
import { TransaccionesTabla } from "./TransaccionesTabla";

const ETIQUETAS_FILTRO: Record<keyof Filtros, string> = {
  mes: "Mes",
  categoria: "Categoría",
  comercio: "Comercio",
};

export function Dashboard() {
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>({});

  useEffect(() => {
    obtenerTransacciones()
      .then(setTransacciones)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <CentroDePagina>
        <p style={{ color: "var(--text-secondary)" }}>Cargando…</p>
      </CentroDePagina>
    );
  }

  if (error) {
    return (
      <CentroDePagina>
        <p style={{ color: "var(--status-critical)" }}>
          No se pudieron cargar las transacciones: {error}
        </p>
      </CentroDePagina>
    );
  }

  // Cross-filter estilo Power BI: cada gráfica se calcula excluyendo su
  // propia dimensión (para poder seguir viendo/cambiando su selección) pero
  // respetando las demás -- así un clic en una gráfica filtra a las otras.
  const transaccionesFiltradas = aplicarFiltros(transacciones, filtros);
  const ingresosGastos = agruparIngresosGastosPorMes(
    aplicarFiltros(transacciones, filtros, "mes")
  );
  const gastoPorCategoria = agruparGastoPorCategoria(
    aplicarFiltros(transacciones, filtros, "categoria")
  );
  const gastoPorComercio = agruparGastoPorComercio(
    aplicarFiltros(transacciones, filtros, "comercio")
  );

  // El saldo actual es un hecho de la cuenta, no una suma que deba
  // encogerse al filtrar por mes/categoría -- siempre viene del set
  // completo. Ingresos/gastos del mes sí responden a los filtros.
  const { saldoActual } = calcularTotales(transacciones);
  const { ingresosMes, gastosMes } = calcularTotales(transaccionesFiltradas);

  function alternarFiltro<K extends keyof Filtros>(campo: K, valor: string) {
    setFiltros((anterior) =>
      anterior[campo] === valor
        ? { ...anterior, [campo]: undefined }
        : { ...anterior, [campo]: valor }
    );
  }

  const hayFiltrosActivos = Object.values(filtros).some(Boolean);

  return (
    <div style={{ background: "var(--page-plane)", minHeight: "100vh" }}>
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <h1
          className="text-lg font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Dashboard Financiero
        </h1>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          Cerrar sesión
        </button>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-6">
        {transacciones.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>
            No hay transacciones sincronizadas todavía — usa la app de
            escritorio para procesar un estado de cuenta y sincronizarlo.
          </p>
        ) : (
          <>
            {hayFiltrosActivos && (
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(filtros) as (keyof Filtros)[])
                  .filter((campo) => filtros[campo])
                  .map((campo) => (
                    <button
                      key={campo}
                      onClick={() => setFiltros((a) => ({ ...a, [campo]: undefined }))}
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
                  onClick={() => setFiltros({})}
                  className="text-xs underline"
                  style={{ color: "var(--text-muted)" }}
                >
                  Limpiar todos los filtros
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile label="Saldo actual" value={saldoActual} />
              <StatTile label="Ingresos del mes" value={ingresosMes} tone="good" />
              <StatTile label="Gastos del mes" value={gastosMes} tone="critical" />
            </div>

            <IngresosGastosChart
              datos={ingresosGastos}
              mesSeleccionado={filtros.mes}
              onClickMes={(mes) => alternarFiltro("mes", mes)}
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
            </div>

            <TransaccionesTabla transacciones={transaccionesFiltradas} />
          </>
        )}
      </main>
    </div>
  );
}

function CentroDePagina({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--page-plane)" }}
    >
      {children}
    </div>
  );
}
