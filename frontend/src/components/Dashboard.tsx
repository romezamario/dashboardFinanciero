import { useEffect, useMemo, useState } from "react";
import {
  agruparPorCategoria,
  agruparPorComercio,
  agruparIngresosGastosPorMes,
  aplicarFiltros,
  calcularPromedios,
  categoriaDe,
  cuentaDe,
  eventoDe,
  obtenerTransacciones,
  ocultarCategorias,
  type Filtros,
} from "../lib/queries";
import type { Transaccion } from "../lib/types";
import { supabase } from "../lib/supabase";
import { StatTile } from "./StatTile";
import { IngresosGastosChart } from "./IngresosGastosChart";
import { GastoPorCategoriaChart } from "./GastoPorCategoriaChart";
import { GastoPorComercioChart } from "./GastoPorComercioChart";
import { TransaccionesTabla } from "./TransaccionesTabla";
import { EditorTransacciones } from "./EditorTransacciones";
import { EventosTab } from "./EventosTab";

const ETIQUETAS_FILTRO: Record<keyof Filtros, string> = {
  mes: "Mes",
  categoria: "Categoría",
  comercio: "Comercio",
  cuenta: "Cuenta",
  tarjeta: "Tarjeta",
  evento: "Evento",
};

const PESTANAS = [
  { id: "resumen", etiqueta: "Resumen" },
  { id: "eventos", etiqueta: "Eventos" },
] as const;

export function Dashboard() {
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>({});
  const [categoriasOcultas, setCategoriasOcultas] = useState<Set<string>>(new Set());
  const [vista, setVista] = useState<(typeof PESTANAS)[number]["id"]>("resumen");

  async function recargarTransacciones() {
    try {
      const datos = await obtenerTransacciones();
      setTransacciones(datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    recargarTransacciones().finally(() => setCargando(false));
  }, []);

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

  if (cargando) {
    return (
      <CentroDePagina>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Cargando…</p>
      </CentroDePagina>
    );
  }

  if (error) {
    return (
      <CentroDePagina>
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          No se pudieron cargar las transacciones: {error}
        </p>
      </CentroDePagina>
    );
  }

  // Categorías ocultas se quitan de raíz antes de todo lo demás -- a
  // diferencia del cross-filter (que aísla UNA categoría a la vez sin
  // tocar las demás gráficas), esto elimina varias categorías del dashboard
  // entero, incluida su propia gráfica de origen.
  const transaccionesVisibles = ocultarCategorias(transacciones, categoriasOcultas);

  // Cross-filter estilo Power BI: cada gráfica se calcula excluyendo su
  // propia dimensión (para poder seguir viendo/cambiando su selección) pero
  // respetando las demás -- así un clic en una gráfica filtra a las otras.
  const transaccionesFiltradas = aplicarFiltros(transaccionesVisibles, filtros);
  const ingresosGastos = agruparIngresosGastosPorMes(
    aplicarFiltros(transaccionesVisibles, filtros, "mes")
  );
  const gastoPorCategoria = agruparPorCategoria(
    aplicarFiltros(transaccionesVisibles, filtros, "categoria")
  );
  const gastoPorComercio = agruparPorComercio(
    aplicarFiltros(transaccionesVisibles, filtros, "comercio")
  );

  // Los promedios responden a categoría/comercio como cualquier gráfica,
  // pero excluyen su propio filtro de "mes" -- son agregados sobre una
  // ventana móvil de 3/12 meses relativa a hoy, así que aplicarles ADEMÁS
  // el filtro de un mes puntual (p. ej. al hacer clic en una barra de
  // IngresosGastosChart) los reduciría a un solo mes de datos divididos
  // entre 3 o 12, o a $0 si ese mes cae fuera de la ventana -- el mismo
  // motivo por el que `ingresosGastos` arriba excluye "mes" de su propio
  // cálculo.
  const { ingresosPromedio3m, gastosPromedio3m, ingresosPromedio12m, gastosPromedio12m } =
    calcularPromedios(aplicarFiltros(transaccionesVisibles, filtros, "mes"));

  function alternarFiltro<K extends keyof Filtros>(campo: K, valor: string) {
    setFiltros((anterior) =>
      anterior[campo] === valor
        ? { ...anterior, [campo]: undefined }
        : { ...anterior, [campo]: valor }
    );
  }

  function alternarCategoriaOculta(categoria: string) {
    setCategoriasOcultas((anterior) => {
      const siguiente = new Set(anterior);
      if (siguiente.has(categoria)) siguiente.delete(categoria);
      else siguiente.add(categoria);
      return siguiente;
    });
    // Evita el estado contradictorio de aislar por clic una categoría que
    // al mismo tiempo se acaba de ocultar (o viceversa).
    if (filtros.categoria === categoria) {
      setFiltros((anterior) => ({ ...anterior, categoria: undefined }));
    }
  }

  function seleccionarCategoria(categoria: string) {
    if (categoriasOcultas.has(categoria)) {
      setCategoriasOcultas((anterior) => {
        const siguiente = new Set(anterior);
        siguiente.delete(categoria);
        return siguiente;
      });
    }
    alternarFiltro("categoria", categoria);
  }

  const hayFiltrosActivos = Object.values(filtros).some(Boolean);

  return (
    <div style={{ background: "var(--page-plane)", minHeight: "100vh" }}>
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <h1
          className="text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Dashboard Financiero
        </h1>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          Cerrar sesión
        </button>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-6">
        {transacciones.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            No hay transacciones sincronizadas todavía — usa la app de
            escritorio para procesar un estado de cuenta y sincronizarlo.
          </p>
        ) : (
          <>
            <div className="flex gap-1" style={{ borderBottom: "1px solid var(--border)" }}>
              {PESTANAS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setVista(tab.id)}
                  className="px-4 py-2 text-xs font-medium"
                  style={{
                    color: vista === tab.id ? "var(--series-1)" : "var(--text-secondary)",
                    borderBottom: `2px solid ${
                      vista === tab.id ? "var(--series-1)" : "transparent"
                    }`,
                  }}
                >
                  {tab.etiqueta}
                </button>
              ))}
            </div>

            {vista === "eventos" ? (
              <EventosTab transacciones={transacciones} onActualizado={recargarTransacciones} />
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
                      onClick={() => setCategoriasOcultas(new Set())}
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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatTile
                    label="Ingresos prom. (3 meses)"
                    value={ingresosPromedio3m}
                    tone="good"
                  />
                  <StatTile
                    label="Gastos prom. (3 meses)"
                    value={gastosPromedio3m}
                    tone="critical"
                  />
                  <StatTile
                    label="Ingresos prom. (12 meses)"
                    value={ingresosPromedio12m}
                    tone="good"
                  />
                  <StatTile
                    label="Gastos prom. (12 meses)"
                    value={gastosPromedio12m}
                    tone="critical"
                  />
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
                    onClickCategoria={seleccionarCategoria}
                  />
                  <GastoPorComercioChart
                    datos={gastoPorComercio}
                    comercioSeleccionado={filtros.comercio}
                    onClickComercio={(comercio) => alternarFiltro("comercio", comercio)}
                  />
                </div>

                <TransaccionesTabla transacciones={transaccionesFiltradas} />

                <EditorTransacciones
                  transacciones={transacciones}
                  onActualizado={recargarTransacciones}
                />
              </>
            )}
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
