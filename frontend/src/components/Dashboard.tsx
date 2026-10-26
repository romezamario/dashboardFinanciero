import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { EDICION, incluyeFuncion, NOMBRE_APP } from "../lib/edicion";
import { LogoMarca } from "./Marca";
import { BotonTema } from "./BotonTema";
import { PESTANAS_SOLO_DUENO, soyInvitado } from "../lib/accesoCompartido";
import { obtenerMuestrasPorConfirmar, type MuestraPorConfirmar } from "../lib/muestras";
import { AvisoMuestraLista } from "./AvisoMuestraLista";
import { categoriasExcluidasPorDefecto, RANGO_MESES_VACIO, type RangoMeses } from "../lib/indicadores";
import type { Transaccion } from "../lib/types";
import { REGRESO_DE_PAGO, supabase } from "../lib/supabase";
import { esTarjetaCredito } from "../lib/tarjetas";
import type { VistaTiempo } from "./IngresosGastosChart";
import { VistaResumen } from "./VistaResumen";
import { LimiteDeError } from "./LimiteDeError";
import { Segmentado } from "./Segmentado";
import { ProveedorMetaDiaria } from "./MetaDiaria";
import { useGastosCorreo } from "../hooks/useGastosCorreo";

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
const WikiTab = lazy(() =>
  cargarPestana(() => import("./WikiTab")).then((m) => ({ default: m.WikiTab }))
);
const MiCuenta = lazy(() =>
  cargarPestana(() => import("./MiCuenta")).then((m) => ({ default: m.MiCuenta }))
);
const SubirEstadoCuenta = lazy(() =>
  cargarPestana(() => import("./SubirEstadoCuenta")).then((m) => ({ default: m.SubirEstadoCuenta }))
);
const AdministracionMuestras = lazy(() =>
  cargarPestana(() => import("./AdministracionMuestras")).then((m) => ({ default: m.AdministracionMuestras }))
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
// Saldo del agente de trading (repo aparte, romezamario/trading-agent; lo
// trae /api/agente-saldo). Como QQQ/TQQQ, no toca Supabase.
// Wiki del sitio: cómo está hecho y qué reglas calculan cada cosa. Un enlace
// a una sección (#wiki-<id>) abre directamente esta pestaña.
const PESTANA_WIKI = "wiki";
// Solo FinanzasPersonales: perfil, contraseña, exportar y borrar la cuenta.
// Se abre desde el encabezado, no es una pestaña más.
const VISTA_CUENTA = "mi-cuenta";
// Solo Ordena tu Lana: leer un PDF en el navegador y guardar sus movimientos
// (fase 2). También se abre desde el encabezado.
const VISTA_SUBIR = "subir";
// Solo Ordena tu Lana y solo para administradores (es_administrador() en la
// base): las muestras anonimizadas de los clientes.
const VISTA_ADMIN = "administracion";
// Prefijo para no chocar con "resumen"/"eventos" si alguna cuenta tuviera
// ese mismo alias.
const PREFIJO_PESTANA_CUENTA = "cuenta:";

// Pestaña abierta, para que al recargar la página se vuelva a la misma
// (sessionStorage: dura lo que la pestaña del navegador, no entre visitas).
const CLAVE_PESTANA = "pestana-activa";

/** Pestaña con la que arranca el tablero: un enlace a una sección de la wiki
 * (#wiki-<id>) manda; si no, la que estaba abierta antes de recargar. Puede
 * ser una pestaña que todavía no existe (las de cuenta salen de los datos):
 * mientras tanto se ve el Resumen y, al cargar, se abre la recordada. */
function vistaInicial(): string {
  if (REGRESO_DE_PAGO && EDICION === "producto") return VISTA_CUENTA;
  if (window.location.hash.startsWith("#wiki-") && incluyeFuncion(EDICION, "wiki")) {
    return PESTANA_WIKI;
  }
  try {
    return sessionStorage.getItem(CLAVE_PESTANA) || PESTANA_RESUMEN;
  } catch {
    return PESTANA_RESUMEN;
  }
}

/** `correo`: el del usuario de la sesión (lo muestra Mi cuenta). */
export function Dashboard({ correo = "" }: { correo?: string } = {}) {
  const [datos, setDatos] = useState<DatosTransacciones | null>(null);
  // Error de la carga inicial (sin datos no hay tablero que mostrar) vs. de
  // una recarga tras editar: esa se avisa arriba sin desmontar la vista, para
  // no perder filtros/selección por un fallo de red momentáneo.
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorRecarga, setErrorRecarga] = useState<string | null>(null);
  const [estadosPorPestana, setEstadosPorPestana] = useState<Record<string, EstadoVista>>({});
  const [vista, setVista] = useState<string>(vistaInicial);
  const [esAdmin, setEsAdmin] = useState(false);
  useEffect(() => {
    if (EDICION !== "producto") return;
    let vigente = true;
    void import("../lib/administracion")
      .then((m) => m.esAdministrador())
      .then((si) => vigente && setEsAdmin(si));
    return () => {
      vigente = false;
    };
  }, []);

  // Acceso compartido (edición personal): un invitado no ve Trading ni la
  // Wiki. Mientras no se sabe, tampoco se muestran (el dueño las ve al llegar
  // la respuesta y, si estaba en una, vuelve a ella).
  const [esDueno, setEsDueno] = useState(EDICION === "producto");
  useEffect(() => {
    if (EDICION !== "personal") return;
    let vigente = true;
    void soyInvitado().then((invitado) => vigente && setEsDueno(!invitado));
    return () => {
      vigente = false;
    };
  }, []);

  // Recompensa por muestras: si una muestra suya ya tiene lector, se le avisa
  // en el tablero (la confirmación vive en "Subir movimientos").
  const [muestrasListas, setMuestrasListas] = useState<MuestraPorConfirmar[]>([]);
  useEffect(() => {
    if (EDICION !== "producto") return;
    let vigente = true;
    obtenerMuestrasPorConfirmar()
      .then((lista) => vigente && setMuestrasListas(lista))
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, []);

  function cambiarVista(id: string) {
    setVista(id);
    try {
      sessionStorage.setItem(CLAVE_PESTANA, id);
    } catch {
      // Almacenamiento bloqueado: solo no se recuerda al recargar.
    }
    // La wiki deja su ancla (#wiki-<id>) en la dirección; al salir de ella se
    // quita, o recargar desde otra pestaña volvería a abrir la wiki.
    if (id !== PESTANA_WIKI && window.location.hash.startsWith("#wiki-")) {
      try {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch {
        // Sin replaceState el ancla se queda; no es grave.
      }
    }
  }
  // Sección elegida dentro del Resumen; se recuerda al cambiar de pestaña.
  const [seccionResumen, setSeccionResumen] = useState<string>(PESTANA_RESUMEN);
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

  // "Actualizar": vuelve a leer de Supabase lo que la app de escritorio sincronizó mientras
  // el tablero estaba abierto (movimientos y avisos de correo), sin recargar la página: se
  // conservan la pestaña, los filtros y el periodo elegidos. Los datos viejos siguen en
  // pantalla mientras llegan los nuevos; si falla, se avisa y se quedan los que había.
  const [actualizando, setActualizando] = useState(false);
  const [errorActualizar, setErrorActualizar] = useState<string | null>(null);
  async function actualizar() {
    if (actualizando) return;
    setActualizando(true);
    setErrorActualizar(null);
    try {
      setDatos(await obtenerDatosTransacciones());
      setErrorRecarga(null);
      if (incluyeFuncion(EDICION, "correo")) avisosCorreo.reintentar();
    } catch (e) {
      setErrorActualizar(e instanceof Error ? e.message : String(e));
    } finally {
      setActualizando(false);
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

  // "Gastos recientes": sus avisos de correo y el archivo de la pestaña se piden en cuanto
  // termina la carga inicial (en segundo plano), y se quedan aquí toda la sesión: abrir la
  // pestaña ya no espera a bajar miles de avisos, y volver a ella no los pide otra vez.
  const cargaInicialLista = datos !== null;
  // En el producto no hay avisos de correo hasta que el cliente pueda conectar su correo (fase 2).
  const avisosCorreo = useGastosCorreo(cargaInicialLista && incluyeFuncion(EDICION, "correo"));
  useEffect(() => {
    if (cargaInicialLista) import("./GastosRecientesTab").catch(() => {});
  }, [cargaInicialLista]);

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
  const transaccionesShophunters = useMemo(
    () => (incluyeFuncion(EDICION, "shophunters") ? soloShophunters(transacciones) : []),
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

  // Tarjetas de crédito, Eventos y Shophunters viven DENTRO del Resumen, con
  // un selector arriba (como las secciones de Trading), no como pestañas.
  const seccionesResumen = [
    { id: PESTANA_RESUMEN, etiqueta: "Resumen" },
    ...(transaccionesTarjetas.length > 0
      ? [{ id: PESTANA_TARJETAS_CREDITO, etiqueta: "Tarjetas de crédito" }]
      : []),
    { id: PESTANA_EVENTOS, etiqueta: "Eventos" },
    ...(transaccionesShophunters.length > 0
      ? [{ id: PESTANA_SHOPHUNTERS, etiqueta: "Shophunters" }]
      : []),
  ];
  const pestanas = [
    { id: PESTANA_RESUMEN, etiqueta: "Resumen" },
    { id: PESTANA_CATEGORIAS_COMERCIOS, etiqueta: "Categorías y Comercios" },
    { id: PESTANA_GASTOS_CORREO, etiqueta: "Gastos recientes" },
    ...cuentasSinTarjeta.map((cuenta) => ({
      id: PREFIJO_PESTANA_CUENTA + cuenta,
      etiqueta: cuenta,
    })),
    // Solo en la edición personal (ver lib/edicion.ts).
    ...(incluyeFuncion(EDICION, "tecnico") ? [{ id: PESTANA_TECNICO, etiqueta: "Trading" }] : []),
    ...(incluyeFuncion(EDICION, "wiki") ? [{ id: PESTANA_WIKI, etiqueta: "Wiki" }] : []),
  ].filter((p) => esDueno || !PESTANAS_SOLO_DUENO.has(p.id));

  // Si la pestaña activa desaparece (p. ej. tras reasignar todos los
  // documentos de una cuenta a otra desde el editor), vuelve al Resumen.
  const enCuenta = vista === VISTA_CUENTA && EDICION === "producto";
  const enSubir = vista === VISTA_SUBIR && EDICION === "producto";
  const enAdmin = vista === VISTA_ADMIN && EDICION === "producto" && esAdmin;
  const pestanaActiva = enCuenta
    ? VISTA_CUENTA
    : enSubir
      ? VISTA_SUBIR
      : enAdmin
        ? VISTA_ADMIN
        : pestanas.some((p) => p.id === vista)
        ? vista
        : PESTANA_RESUMEN;
  // Igual para la sección del Resumen (Tarjetas/Shophunters solo existen si
  // hay movimientos suyos).
  const seccionActiva = seccionesResumen.some((s) => s.id === seccionResumen)
    ? seccionResumen
    : PESTANA_RESUMEN;
  const vistaActiva = pestanaActiva === PESTANA_RESUMEN ? seccionActiva : pestanaActiva;

  // En el teléfono la fila de pestañas se desliza de lado: que la pestaña
  // abierta siempre quede a la vista (p. ej. al volver de "Mi cuenta").
  const filaPestanas = useRef<HTMLDivElement>(null);
  const hayDatos = datos !== null;
  useEffect(() => {
    const fila = filaPestanas.current;
    const activa = fila?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!fila || !activa) return;
    const izquierda = activa.offsetLeft - fila.offsetLeft;
    if (izquierda < fila.scrollLeft || izquierda + activa.offsetWidth > fila.scrollLeft + fila.clientWidth)
      fila.scrollTo({ left: Math.max(0, izquierda - 16) });
  }, [pestanaActiva, hayDatos]);

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
    opciones: { sinTasaDeAhorro?: boolean; sinTarjetasIndicadores?: boolean; conPromedios?: boolean } = {}
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
        sinTarjetasIndicadores={opciones.sinTarjetasIndicadores}
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
          {EDICION === "producto" ? <LogoMarca /> : NOMBRE_APP}
        </h1>
        {/* En el teléfono las acciones van en su propia fila, de lado a lado y
            con altura de dedo (h-9); desde sm quedan como siempre. */}
        <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-end sm:gap-4">
          <button
            onClick={() => void actualizar()}
            disabled={actualizando}
            className="h-9 whitespace-nowrap rounded-full px-3 text-xs font-medium sm:h-auto sm:py-1"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              opacity: actualizando ? 0.6 : 1,
            }}
            title="Volver a leer los datos sin recargar la página (por ejemplo, después de sincronizar desde la app de escritorio)"
          >
            {actualizando ? "Actualizando…" : "↻ Actualizar"}
          </button>
          <BotonTema soloIconoEnMovil />
          {EDICION === "producto" && (
            <button
              onClick={() => cambiarVista(VISTA_SUBIR)}
              className={`${BOTON_ENCABEZADO} font-medium`}
              style={{ color: enSubir ? "var(--marca)" : "var(--text-secondary)" }}
              aria-current={enSubir ? "page" : undefined}
            >
              <span className="sm:hidden">Subir</span>
              <span className="hidden sm:inline">Subir movimientos</span>
            </button>
          )}
          {EDICION === "producto" && esAdmin && (
            <button
              onClick={() => cambiarVista(VISTA_ADMIN)}
              className={`${BOTON_ENCABEZADO} font-medium`}
              style={{ color: enAdmin ? "var(--marca)" : "var(--text-secondary)" }}
              aria-current={enAdmin ? "page" : undefined}
            >
              <span className="sm:hidden">Admin</span>
              <span className="hidden sm:inline">Administración</span>
            </button>
          )}
          {EDICION === "producto" && (
            <button
              onClick={() => cambiarVista(VISTA_CUENTA)}
              className={`${BOTON_ENCABEZADO} font-medium`}
              style={{ color: enCuenta ? "var(--marca)" : "var(--text-secondary)" }}
              aria-current={enCuenta ? "page" : undefined}
            >
              Mi cuenta
            </button>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className={BOTON_ENCABEZADO}
            style={{ color: "var(--text-secondary)" }}
          >
            <span className="sm:hidden">Salir</span>
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        {errorActualizar && (
          <div
            role="alert"
            className="rounded-md px-4 py-2 text-xs"
            style={{ border: "1px solid var(--status-critical)", color: "var(--text-primary)" }}
          >
            No se pudieron actualizar los datos; sigues viendo los anteriores: {errorActualizar}
          </div>
        )}
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
        {!enSubir &&
          muestrasListas.map((m) => (
            <AvisoMuestraLista
              key={m.id}
              muestra={m}
              accion={
                <button
                  onClick={() => (setMuestrasListas([]), cambiarVista(VISTA_SUBIR))}
                  className="rounded-md px-4 py-2 text-sm font-medium text-white"
                  style={{ background: "var(--marca)" }}
                >
                  Subir mi estado de cuenta
                </button>
              }
            />
          ))}
        <div
          ref={filaPestanas}
          className="sin-barra flex gap-1 overflow-x-auto"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          {pestanas.map((tab) => (
            <button
              key={tab.id}
              onClick={() => cambiarVista(tab.id)}
              aria-current={pestanaActiva === tab.id ? "page" : undefined}
              className="whitespace-nowrap px-4 py-3 text-xs font-medium sm:py-2"
              style={{
                color: pestanaActiva === tab.id ? "var(--marca)" : "var(--text-secondary)",
                borderBottom: `2px solid ${
                  pestanaActiva === tab.id ? "var(--marca)" : "transparent"
                }`,
              }}
            >
              {tab.etiqueta}
            </button>
          ))}
        </div>

        {pestanaActiva === PESTANA_RESUMEN && transacciones.length > 0 && (
          <Segmentado
            opciones={seccionesResumen}
            valor={seccionActiva}
            onCambiar={setSeccionResumen}
          />
        )}

        {/* La meta de gasto diario de "Gastos recientes" se lee una vez por sesión, no
            cada vez que se abre la pestaña. */}
        <ProveedorMetaDiaria>
        <LimiteDeError
          key={vistaActiva}
          nombre={
            enCuenta
              ? "Mi cuenta"
              : enSubir
                ? "Subir movimientos"
                : enAdmin
                  ? "Administración"
                  : `la pestaña ${
                  [...seccionesResumen, ...pestanas].find((p) => p.id === vistaActiva)?.etiqueta ?? ""
                }`
          }
        >
        <Suspense
          fallback={
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Cargando…</p>
          }
        >
        {enCuenta ? (
          <MiCuenta correo={correo} transacciones={transacciones} />
        ) : enSubir ? (
          <SubirEstadoCuenta transacciones={transacciones} onGuardado={() => void recargarTransacciones()} />
        ) : enAdmin ? (
          <AdministracionMuestras
            totalMovimientos={transacciones.length}
            onDatosBorrados={() => void recargarTransacciones()}
          />
        ) : vistaActiva === PESTANA_WIKI ? (
          <WikiTab />
        ) : vistaActiva === PESTANA_TECNICO ? (
          <AnalisisTecnicoTab />
        ) : vistaActiva === PESTANA_GASTOS_CORREO ? (
          <GastosRecientesTab
            transacciones={transacciones}
            eventosCatalogo={datos.catalogos.eventos}
            filasCorreo={avisosCorreo.filas}
            errorCorreo={avisosCorreo.error}
            onCambiarFilasCorreo={avisosCorreo.setFilas}
            onReintentarCorreo={avisosCorreo.reintentar}
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
          EDICION === "producto" ? (
            <div className="tarjeta space-y-3 rounded-lg p-6 text-center">
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                Todavía no tienes movimientos. Empieza subiendo el PDF de tu estado de cuenta, la plantilla de Excel o capturándolos a mano.
              </p>
              <button
                onClick={() => cambiarVista(VISTA_SUBIR)}
                className="rounded-md px-4 py-2 text-sm font-medium text-white"
                style={{ background: "var(--marca)" }}
              >
                Subir movimientos
              </button>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              No hay transacciones sincronizadas todavía — usa la app de escritorio para procesar un estado de cuenta y
              sincronizarlo.
            </p>
          )
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
            sinTarjetasIndicadores: true,
            conPromedios: true,
          })
        ) : vistaActiva === PESTANA_RESUMEN ? (
          renderVistaResumen(PESTANA_RESUMEN, transacciones)
        ) : (
          renderVistaResumen(vistaActiva, transaccionesPorCuenta.get(vistaActiva) ?? [])
        )}
        </Suspense>
        </LimiteDeError>
        </ProveedorMetaDiaria>
      </main>
    </div>
  );
}

/** Botón de texto del encabezado: en el teléfono, alto de dedo (h-9) y sin
 * partirse en dos renglones; en escritorio, igual que antes. */
const BOTON_ENCABEZADO = "h-9 whitespace-nowrap px-1.5 text-xs sm:h-auto sm:px-0";

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
