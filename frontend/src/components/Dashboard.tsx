import { useEffect, useMemo, useState } from "react";
import { categoriaDe, cuentaDe, obtenerTransacciones, type Filtros } from "../lib/queries";
import { categoriasExcluidasPorDefecto, RANGO_FECHAS_VACIO, type RangoFechas } from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { supabase } from "../lib/supabase";
import { EventosTab } from "./EventosTab";
import { IndicadoresTab } from "./IndicadoresTab";
import { VistaResumen } from "./VistaResumen";

/** Estado de filtros de UNA pestaña -- cada pestaña (Resumen y una por
 * tarjeta) tiene el suyo, guardado en `estadosPorPestana`, para que
 * filtrar o ocultar categorías en una no afecte a las demás. `rangoFechas`
 * solo lo usa Indicadores hoy, pero vive aquí igual que `categoriasOcultas`
 * (que Indicadores también reutiliza con otro significado) para no perder
 * la selección al cambiar de pestaña. */
interface EstadoVista {
  filtros: Filtros;
  categoriasOcultas: Set<string>;
  rangoFechas: RangoFechas;
}

const ESTADO_VACIO: EstadoVista = {
  filtros: {},
  categoriasOcultas: new Set(),
  rangoFechas: RANGO_FECHAS_VACIO,
};

const PESTANA_RESUMEN = "resumen";
const PESTANA_EVENTOS = "eventos";
const PESTANA_INDICADORES = "indicadores";
// Prefijo para no chocar con "resumen"/"eventos" si alguna cuenta tuviera
// ese mismo alias.
const PREFIJO_PESTANA_CUENTA = "cuenta:";

type Tema = "light" | "dark";
const CLAVE_TEMA = "tema";

/** El botón de tema alterna sobre lo que se ve HOY, sin importar si viene
 * del sistema o de una elección previa -- por eso lee `data-theme` (ya
 * aplicado por el script inline de index.html si el usuario había elegido
 * uno) y si no hay ninguno forzado, cae al `prefers-color-scheme` real del
 * navegador en vez de asumir "light". */
function temaEfectivoInicial(): Tema {
  const forzado = document.documentElement.getAttribute("data-theme");
  if (forzado === "light" || forzado === "dark") return forzado;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function Dashboard() {
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estadosPorPestana, setEstadosPorPestana] = useState<Record<string, EstadoVista>>({});
  const [vista, setVista] = useState<string>(PESTANA_RESUMEN);
  const [tema, setTema] = useState<Tema>(temaEfectivoInicial);

  function alternarTema() {
    setTema((anterior) => {
      const siguiente: Tema = anterior === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", siguiente);
      localStorage.setItem(CLAVE_TEMA, siguiente);
      return siguiente;
    });
  }

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

  // Una pestaña por tarjeta = una por cuenta (`cuentas.alias`, p. ej.
  // "TDC Beyond", "Invex TDC") -- no por `transacciones.tarjeta`
  // (Titular/Adicional/Digital), que se repite entre cuentas distintas y
  // sigue disponible como filtro dentro de cada pestaña.
  const cuentasConocidas = useMemo(
    () => Array.from(new Set(transacciones.map(cuentaDe))).sort(),
    [transacciones]
  );

  const pestanas = [
    { id: PESTANA_RESUMEN, etiqueta: "Resumen" },
    { id: PESTANA_EVENTOS, etiqueta: "Eventos" },
    { id: PESTANA_INDICADORES, etiqueta: "Indicadores" },
    ...cuentasConocidas.map((cuenta) => ({
      id: PREFIJO_PESTANA_CUENTA + cuenta,
      etiqueta: cuenta,
    })),
  ];

  // Si la pestaña activa desaparece (p. ej. tras reasignar todos los
  // documentos de una cuenta a otra desde el editor), vuelve al Resumen.
  const vistaActiva = pestanas.some((p) => p.id === vista) ? vista : PESTANA_RESUMEN;

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

  function actualizarEstado(pestana: string, cambio: (anterior: EstadoVista) => EstadoVista) {
    setEstadosPorPestana((anteriores) => ({
      ...anteriores,
      [pestana]: cambio(anteriores[pestana] ?? ESTADO_VACIO),
    }));
  }

  function renderVistaResumen(pestana: string, transaccionesVista: Transaccion[]) {
    const estado = estadosPorPestana[pestana] ?? ESTADO_VACIO;
    return (
      <VistaResumen
        // `key` por pestaña: sin ella React reutilizaría la misma instancia
        // al cambiar entre pestañas de tarjeta y el estado interno del
        // editor masivo (búsqueda, selección) se arrastraría de una a otra.
        key={pestana}
        transacciones={transaccionesVista}
        catalogo={transacciones}
        filtros={estado.filtros}
        onCambiarFiltros={(cambio) =>
          actualizarEstado(pestana, (e) => ({ ...e, filtros: cambio(e.filtros) }))
        }
        categoriasOcultas={estado.categoriasOcultas}
        onCambiarCategoriasOcultas={(cambio) =>
          actualizarEstado(pestana, (e) => ({
            ...e,
            categoriasOcultas: cambio(e.categoriasOcultas),
          }))
        }
        onActualizado={recargarTransacciones}
      />
    );
  }

  // La pestaña Indicadores reutiliza `categoriasOcultas` de su estado por
  // pestaña como "categorías excluidas". Hasta que el usuario toque la
  // selección, arranca excluyendo los movimientos entre cuentas propias (ver
  // categoriasExcluidasPorDefecto).
  const categoriasExcluidasIndicadores =
    estadosPorPestana[PESTANA_INDICADORES]?.categoriasOcultas ??
    categoriasExcluidasPorDefecto(Array.from(new Set(transacciones.map(categoriaDe))));

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
        <div className="flex items-center gap-4">
          <button
            onClick={alternarTema}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
            title={tema === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            {tema === "dark" ? "Modo claro" : "Modo oscuro"}
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-6">
        {transacciones.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            No hay transacciones sincronizadas todavía — usa la app de
            escritorio para procesar un estado de cuenta y sincronizarlo.
          </p>
        ) : (
          <>
            <div
              className="flex gap-1 overflow-x-auto"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              {pestanas.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setVista(tab.id)}
                  className="whitespace-nowrap px-4 py-2 text-xs font-medium"
                  style={{
                    color: vistaActiva === tab.id ? "var(--series-1)" : "var(--text-secondary)",
                    borderBottom: `2px solid ${
                      vistaActiva === tab.id ? "var(--series-1)" : "transparent"
                    }`,
                  }}
                >
                  {tab.etiqueta}
                </button>
              ))}
            </div>

            {vistaActiva === PESTANA_INDICADORES ? (
              <IndicadoresTab
                transacciones={transacciones}
                categoriasExcluidas={categoriasExcluidasIndicadores}
                onCambiarCategoriasExcluidas={(cambio) =>
                  actualizarEstado(PESTANA_INDICADORES, (e) => ({
                    ...e,
                    categoriasOcultas: cambio(categoriasExcluidasIndicadores),
                  }))
                }
                rangoFechas={estadosPorPestana[PESTANA_INDICADORES]?.rangoFechas ?? RANGO_FECHAS_VACIO}
                onCambiarRangoFechas={(cambio) =>
                  actualizarEstado(PESTANA_INDICADORES, (e) => ({
                    ...e,
                    rangoFechas: cambio(e.rangoFechas),
                  }))
                }
              />
            ) : vistaActiva === PESTANA_EVENTOS ? (
              <EventosTab transacciones={transacciones} onActualizado={recargarTransacciones} />
            ) : vistaActiva === PESTANA_RESUMEN ? (
              renderVistaResumen(PESTANA_RESUMEN, transacciones)
            ) : (
              renderVistaResumen(
                vistaActiva,
                transacciones.filter(
                  (t) => PREFIJO_PESTANA_CUENTA + cuentaDe(t) === vistaActiva
                )
              )
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
