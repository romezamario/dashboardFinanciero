import { useEffect, useMemo, useState } from "react";
import { categoriaDe, cuentaDe, obtenerTransacciones, type Filtros } from "../lib/queries";
import { categoriasExcluidasPorDefecto, RANGO_MESES_VACIO, type RangoMeses } from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { supabase } from "../lib/supabase";
import { EventosTab } from "./EventosTab";
import type { VistaTiempo } from "./IngresosGastosChart";
import { VistaResumen } from "./VistaResumen";

/** Estado de filtros de UNA pestaña -- cada pestaña (Resumen y una por
 * tarjeta) tiene el suyo, guardado en `estadosPorPestana`, para que
 * filtrar, elegir periodo u ocultar categorías en una no afecte a las
 * demás. */
interface EstadoVista {
  filtros: Filtros;
  /** null = el usuario aún no toca la selección: se usan las categorías
   * ocultas por defecto (movimientos entre cuentas propias, ver
   * categoriasExcluidasPorDefecto). Resolverlo al render -- y no copiarlo
   * al crear el estado -- evita que el primer cambio de OTRO campo (p. ej.
   * el periodo) cree el estado desde vacío y vuelva a mostrar "Pago TDC". */
  categoriasOcultas: Set<string> | null;
  rangoMeses: RangoMeses;
  vistaTiempo: VistaTiempo;
}

const ESTADO_VACIO: EstadoVista = {
  filtros: {},
  categoriasOcultas: null,
  rangoMeses: RANGO_MESES_VACIO,
  vistaTiempo: "meses",
};

const PESTANA_RESUMEN = "resumen";
const PESTANA_EVENTOS = "eventos";
// Prefijo para no chocar con "resumen"/"eventos" si alguna cuenta tuviera
// ese mismo alias.
const PREFIJO_PESTANA_CUENTA = "cuenta:";

export function Dashboard() {
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estadosPorPestana, setEstadosPorPestana] = useState<Record<string, EstadoVista>>({});
  const [vista, setVista] = useState<string>(PESTANA_RESUMEN);

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

  // Por defecto se ocultan los movimientos entre cuentas propias (p. ej.
  // pagar la TDC desde la cuenta de cheques): contarían como gasto en una
  // cuenta e ingreso en la otra. Memoizado (igual que las transacciones por
  // cuenta abajo) para que su identidad no cambie en cada render: VistaResumen
  // memoiza todos sus cálculos sobre estas referencias, y un Set/arreglo nuevo
  // en cada render los invalidaba todos.
  const categoriasOcultasPorDefecto = useMemo(
    () => categoriasExcluidasPorDefecto(Array.from(new Set(transacciones.map(categoriaDe)))),
    [transacciones]
  );
  const transaccionesPorCuenta = useMemo(() => {
    const porCuenta = new Map<string, Transaccion[]>();
    for (const t of transacciones) {
      const clave = PREFIJO_PESTANA_CUENTA + cuentaDe(t);
      const lista = porCuenta.get(clave);
      if (lista) lista.push(t);
      else porCuenta.set(clave, [t]);
    }
    return porCuenta;
  }, [transacciones]);

  const pestanas = [
    { id: PESTANA_RESUMEN, etiqueta: "Resumen" },
    { id: PESTANA_EVENTOS, etiqueta: "Eventos" },
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
    const categoriasOcultas = estado.categoriasOcultas ?? categoriasOcultasPorDefecto;
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
        categoriasOcultas={categoriasOcultas}
        onCambiarCategoriasOcultas={(cambio) =>
          actualizarEstado(pestana, (e) => ({
            ...e,
            categoriasOcultas: cambio(e.categoriasOcultas ?? categoriasOcultasPorDefecto),
          }))
        }
        rangoMeses={estado.rangoMeses}
        onCambiarRangoMeses={(cambio) =>
          actualizarEstado(pestana, (e) => ({ ...e, rangoMeses: cambio(e.rangoMeses) }))
        }
        vistaTiempo={estado.vistaTiempo}
        onCambiarVistaTiempo={(vistaTiempo) =>
          actualizarEstado(pestana, (e) => ({ ...e, vistaTiempo }))
        }
        onActualizado={recargarTransacciones}
      />
    );
  }

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

            {vistaActiva === PESTANA_EVENTOS ? (
              <EventosTab transacciones={transacciones} onActualizado={recargarTransacciones} />
            ) : vistaActiva === PESTANA_RESUMEN ? (
              renderVistaResumen(PESTANA_RESUMEN, transacciones)
            ) : (
              renderVistaResumen(vistaActiva, transaccionesPorCuenta.get(vistaActiva) ?? [])
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
