import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  armarTransacciones,
  categoriaDe,
  cuentaDe,
  eventoDe,
  obtenerCatalogos,
  obtenerDatosTransacciones,
  obtenerFilasPorIds,
  reemplazarFilas,
  type DatosTransacciones,
  type Filtros,
} from "../lib/queries";
import { eventosOcultosPorDefecto, eventosVisiblesTras } from "../lib/gastosEstadoCuenta";
import { soloShophunters } from "../lib/shophunters";
import { categoriasExcluidasPorDefecto, RANGO_MESES_VACIO, type RangoMeses } from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { supabase } from "../lib/supabase";
import { esTarjetaCredito } from "../lib/tarjetas";
import type { VistaTiempo } from "./IngresosGastosChart";
import { VistaResumen } from "./VistaResumen";

// Cada pestaña que no es la de inicio se baja al abrirla por primera vez:
// el análisis técnico/macro, el calendario de gastos, eventos y tarjetas
// juntos eran la mayor parte del bundle y casi nunca se usan al entrar.
//
// Si el tablero quedó abierto durante un deploy, el archivo de la pestaña de
// la versión anterior ya no existe (Cloudflare solo sirve la última): en vez
// de romper la vista, se recarga la página UNA vez para tomar la nueva.
const CLAVE_RECARGA_POR_VERSION = "recargado-por-version-nueva";

function cargarPestana<T>(importar: () => Promise<T>): Promise<T> {
  return importar().then(
    (modulo) => {
      try {
        sessionStorage.removeItem(CLAVE_RECARGA_POR_VERSION);
      } catch {
        // sin sessionStorage no hay nada que limpiar
      }
      return modulo;
    },
    (error: unknown) => {
      try {
        if (!sessionStorage.getItem(CLAVE_RECARGA_POR_VERSION)) {
          sessionStorage.setItem(CLAVE_RECARGA_POR_VERSION, "1");
          window.location.reload();
          return new Promise<T>(() => {});
        }
      } catch {
        // sin sessionStorage no se puede evitar un ciclo de recargas: falla
      }
      throw error;
    }
  );
}
const AnalisisTecnicoTab = lazy(() =>
  cargarPestana(() => import("./AnalisisTecnicoTab")).then((m) => ({ default: m.AnalisisTecnicoTab }))
);
const DetalleDimensionTab = lazy(() =>
  cargarPestana(() => import("./DetalleDimensionTab")).then((m) => ({ default: m.DetalleDimensionTab }))
);
const EventosTab = lazy(() =>
  cargarPestana(() => import("./EventosTab")).then((m) => ({ default: m.EventosTab }))
);
const GastosRecientesTab = lazy(() =>
  cargarPestana(() => import("./GastosRecientesTab")).then((m) => ({ default: m.GastosRecientesTab }))
);
const TarjetasCreditoTab = lazy(() =>
  cargarPestana(() => import("./TarjetasCreditoTab")).then((m) => ({ default: m.TarjetasCreditoTab }))
);

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
  /** A diferencia de categoriasOcultas, sin default -- ningún evento se
   * descarta hasta que el usuario lo elige explícitamente. */
  eventosOcultos: Set<string>;
  /** Solo "Gastos recientes" (por estado de cuenta): los eventos que el usuario VOLVIÓ a
   * mostrar. Todos los demás -- también los eventos nuevos -- empiezan ocultos (ver
   * eventosOcultosPorDefecto); por eso se guarda lo visible y no lo oculto. */
  eventosVisibles: Set<string>;
  rangoMeses: RangoMeses;
  vistaTiempo: VistaTiempo;
}

const ESTADO_VACIO: EstadoVista = {
  filtros: {},
  categoriasOcultas: null,
  eventosOcultos: new Set(),
  eventosVisibles: new Set(),
  rangoMeses: RANGO_MESES_VACIO,
  vistaTiempo: "recientes",
};

const PESTANA_RESUMEN = "resumen";
const PESTANA_EVENTOS = "eventos";
// Mismo VistaResumen que el Resumen, pero solo con los eventos de Shophunters.
const PESTANA_SHOPHUNTERS = "shophunters";
const PESTANA_CATEGORIAS_COMERCIOS = "categorias-comercios";
const PESTANA_TARJETAS_CREDITO = "tarjetas-credito";
// "Gastos recientes": vista por correo (tabla gastos_correo, carga sus propios
// datos) y vista por estado de cuenta (las transacciones de arriba, con su
// propio "Ocultar categorías" guardado en el estado de esta pestaña).
const PESTANA_GASTOS_CORREO = "gastos-correo";
// Análisis técnico de QQQ/TQQQ: no usa las transacciones (cotizaciones de
// /api/cotizaciones), solo vive aquí para tener todo en un mismo lugar.
const PESTANA_TECNICO = "tecnico";
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
  const [datos, setDatos] = useState<DatosTransacciones | null>(null);
  // Error de la carga inicial (sin datos no hay tablero que mostrar) vs. de
  // una recarga tras editar: esa se avisa arriba sin desmontar la vista, para
  // no perder filtros/selección por un fallo de red momentáneo.
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorRecarga, setErrorRecarga] = useState<string | null>(null);
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

  /** Tras una edición: con `ids`, solo esas filas más los catálogos (una
   * categoría/evento nuevo, o un documento que cambió de cuenta, viven ahí)
   * en vez de volver a bajar todo el historial; sin `ids`, todo. Nunca lanza:
   * los cambios ya se guardaron, un fallo aquí solo deja la vista desfasada. */
  async function recargarTransacciones(ids?: string[]) {
    try {
      if (ids === undefined) {
        setDatos(await obtenerDatosTransacciones());
      } else {
        const [catalogos, filas] = await Promise.all([obtenerCatalogos(), obtenerFilasPorIds(ids)]);
        setDatos((anteriores) =>
          anteriores && { catalogos, filas: reemplazarFilas(anteriores.filas, filas) }
        );
      }
      setErrorRecarga(null);
    } catch (e) {
      setErrorRecarga(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    let vigente = true;
    obtenerDatosTransacciones().then(
      (cargados) => vigente && setDatos(cargados),
      (e) => vigente && setErrorCarga(e instanceof Error ? e.message : String(e))
    );
    return () => {
      vigente = false;
    };
  }, []);

  const transacciones = useMemo<Transaccion[]>(
    () => (datos ? armarTransacciones(datos.filas, datos.catalogos) : []),
    [datos]
  );

  // Las tarjetas de crédito comparten UNA pestaña de comparación
  // ("Tarjetas de crédito", ver TarjetasCreditoTab); solo las cuentas que no
  // son TDC (p. ej. la de cheques, "Priority") conservan su propia pestaña
  // con la vista completa del Resumen.
  const transaccionesTarjetas = useMemo(
    () => transacciones.filter(esTarjetaCredito),
    [transacciones]
  );
  const cuentasSinTarjeta = useMemo(() => {
    const tarjetas = new Set(transaccionesTarjetas.map(cuentaDe));
    return Array.from(new Set(transacciones.map(cuentaDe)))
      .filter((cuenta) => !tarjetas.has(cuenta))
      .sort();
  }, [transacciones, transaccionesTarjetas]);

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
  // "Gastos recientes" (por estado de cuenta): los eventos empiezan TODOS ocultos.
  const eventosExistentes = useMemo(
    () => Array.from(new Set(transacciones.map(eventoDe).filter((e): e is string => e !== null))),
    [transacciones]
  );
  const eventosVisiblesGastos = (estadosPorPestana[PESTANA_GASTOS_CORREO] ?? ESTADO_VACIO).eventosVisibles;
  const eventosOcultosGastos = useMemo(
    () => eventosOcultosPorDefecto(eventosExistentes, eventosVisiblesGastos),
    [eventosExistentes, eventosVisiblesGastos]
  );
  const transaccionesShophunters = useMemo(() => soloShophunters(transacciones), [transacciones]);
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
    ...(transaccionesShophunters.length > 0
      ? [{ id: PESTANA_SHOPHUNTERS, etiqueta: "Shophunters" }]
      : []),
    { id: PESTANA_CATEGORIAS_COMERCIOS, etiqueta: "Categorías y Comercios" },
    ...(transaccionesTarjetas.length > 0
      ? [{ id: PESTANA_TARJETAS_CREDITO, etiqueta: "Tarjetas de crédito" }]
      : []),
    { id: PESTANA_GASTOS_CORREO, etiqueta: "Gastos recientes" },
    ...cuentasSinTarjeta.map((cuenta) => ({
      id: PREFIJO_PESTANA_CUENTA + cuenta,
      etiqueta: cuenta,
    })),
    { id: PESTANA_TECNICO, etiqueta: "QQQ / TQQQ" },
  ];

  // Si la pestaña activa desaparece (p. ej. tras reasignar todos los
  // documentos de una cuenta a otra desde el editor), vuelve al Resumen.
  const vistaActiva = pestanas.some((p) => p.id === vista) ? vista : PESTANA_RESUMEN;

  if (errorCarga) {
    return (
      <CentroDePagina>
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          No se pudieron cargar las transacciones: {errorCarga}
        </p>
      </CentroDePagina>
    );
  }

  if (!datos) {
    return (
      <CentroDePagina>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Cargando…</p>
      </CentroDePagina>
    );
  }

  function actualizarEstado(pestana: string, cambio: (anterior: EstadoVista) => EstadoVista) {
    setEstadosPorPestana((anteriores) => ({
      ...anteriores,
      [pestana]: cambio(anteriores[pestana] ?? ESTADO_VACIO),
    }));
  }

  function renderVistaResumen(
    pestana: string,
    transaccionesVista: Transaccion[],
    opciones: { sinTasaDeAhorro?: boolean; conPromedios?: boolean } = {}
  ) {
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
        eventosOcultos={estado.eventosOcultos}
        onCambiarEventosOcultos={(cambio) =>
          actualizarEstado(pestana, (e) => ({ ...e, eventosOcultos: cambio(e.eventosOcultos) }))
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
        sinTasaDeAhorro={opciones.sinTasaDeAhorro}
        conPromediosEnGrafica={opciones.conPromedios}
      />
    );
  }

  return (
    <div style={{ background: "var(--page-plane)", minHeight: "100vh" }}>
      <header
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <h1
          className="text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Dashboard Financiero
        </h1>
        <div className="flex items-center gap-2 sm:gap-4">
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

      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        {errorRecarga && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-md px-4 py-2 text-xs"
            style={{ border: "1px solid var(--status-critical)", color: "var(--text-primary)" }}
          >
            <span>
              Los cambios se guardaron, pero no se pudo recargar la vista: {errorRecarga}
            </span>
            <button
              onClick={() => recargarTransacciones()}
              className="rounded-md px-3 py-1 font-medium"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              Reintentar
            </button>
          </div>
        )}
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

        <Suspense
          fallback={
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Cargando…</p>
          }
        >
        {vistaActiva === PESTANA_TECNICO ? (
          <AnalisisTecnicoTab />
        ) : vistaActiva === PESTANA_GASTOS_CORREO ? (
          <GastosRecientesTab
            transacciones={transacciones}
            // Su propio "Ocultar categorías": se guarda aparte del Resumen
            // (misma lógica de default `null` = categorías de pagos entre cuentas).
            categoriasOcultas={
              (estadosPorPestana[PESTANA_GASTOS_CORREO] ?? ESTADO_VACIO).categoriasOcultas ??
              categoriasOcultasPorDefecto
            }
            onCambiarCategoriasOcultas={(cambio) =>
              actualizarEstado(PESTANA_GASTOS_CORREO, (e) => ({
                ...e,
                categoriasOcultas: cambio(e.categoriasOcultas ?? categoriasOcultasPorDefecto),
              }))
            }
            eventosOcultos={eventosOcultosGastos}
            onCambiarEventosOcultos={(cambio) =>
              actualizarEstado(PESTANA_GASTOS_CORREO, (e) => ({
                ...e,
                eventosVisibles: eventosVisiblesTras(
                  eventosExistentes,
                  cambio(eventosOcultosPorDefecto(eventosExistentes, e.eventosVisibles))
                ),
              }))
            }
            onActualizado={recargarTransacciones}
          />
        ) : transacciones.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            No hay transacciones sincronizadas todavía — usa la app de
            escritorio para procesar un estado de cuenta y sincronizarlo.
          </p>
        ) : vistaActiva === PESTANA_EVENTOS ? (
          <EventosTab transacciones={transacciones} onActualizado={recargarTransacciones} />
        ) : vistaActiva === PESTANA_TARJETAS_CREDITO ? (
          <TarjetasCreditoTab
            transacciones={transaccionesTarjetas}
            rangoMeses={(estadosPorPestana[PESTANA_TARJETAS_CREDITO] ?? ESTADO_VACIO).rangoMeses}
            onCambiarRangoMeses={(cambio) =>
              actualizarEstado(PESTANA_TARJETAS_CREDITO, (e) => ({
                ...e,
                rangoMeses: cambio(e.rangoMeses),
              }))
            }
            filtros={(estadosPorPestana[PESTANA_TARJETAS_CREDITO] ?? ESTADO_VACIO).filtros}
            onCambiarFiltros={(cambio) =>
              actualizarEstado(PESTANA_TARJETAS_CREDITO, (e) => ({
                ...e,
                filtros: cambio(e.filtros),
              }))
            }
          />
        ) : vistaActiva === PESTANA_CATEGORIAS_COMERCIOS ? (
          <DetalleDimensionTab transacciones={transacciones} />
        ) : vistaActiva === PESTANA_SHOPHUNTERS ? (
          renderVistaResumen(PESTANA_SHOPHUNTERS, transaccionesShophunters, {
            sinTasaDeAhorro: true,
            conPromedios: true,
          })
        ) : vistaActiva === PESTANA_RESUMEN ? (
          renderVistaResumen(PESTANA_RESUMEN, transacciones)
        ) : (
          renderVistaResumen(vistaActiva, transaccionesPorCuenta.get(vistaActiva) ?? [])
        )}
        </Suspense>
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
