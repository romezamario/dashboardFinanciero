import { useEffect, useState, type ReactNode } from "react";
import {
  borrarMuestra,
  cambiarEstadoMuestra,
  ESTADOS_MUESTRA,
  filtrarMuestras,
  MOTIVOS_MUESTRA,
  obtenerBonificacionesOtorgadas,
  obtenerMuestras,
  obtenerTextoMuestra,
  prepararResolucion,
  reiniciarMisDatos,
  resolverMuestra,
  RESULTADOS_MUESTRA,
  textoParaClaude,
  type BonificacionOtorgada,
  type EstadoMuestra,
  type Muestra,
  type ResultadoMuestra,
} from "../lib/administracion";
import { LECTORES } from "../lib/importar/procesar";
import { confirmaBorrado, PALABRA_BORRAR } from "../lib/cuentaUsuario";
import { descargarTexto } from "../lib/exportarDatos";
import { PAGOS_EN_PRUEBA, reiniciarMisPagos } from "../lib/suscripcion";
import { entero, fechaHora } from "../lib/formato";

// Administración de Ordena tu Lana (solo la ve quien es_administrador()): las
// muestras anonimizadas que mandan los clientes cuando no leemos su PDF. El
// dueño copia el texto, se lo pasa a Claude para que proponga el lector, y
// la resuelve: lector nuevo / arreglo (con la clave del cambio, que da la
// recompensa una sola vez cuando el cliente confirma), repetida o descarte.

type Filtro = EstadoMuestra | "pendientes" | "todas";

const estiloEntrada = {
  background: "var(--page-plane)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};

export function AdministracionMuestras({
  totalMovimientos,
  onDatosBorrados,
}: {
  totalMovimientos: number;
  onDatosBorrados: () => void;
}) {
  const [muestras, setMuestras] = useState<Muestra[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [recargas, setRecargas] = useState(0);
  const [bonificaciones, setBonificaciones] = useState<BonificacionOtorgada[]>([]);

  useEffect(() => {
    let vigente = true;
    obtenerMuestras()
      .then((lista) => vigente && (setMuestras(lista), setError(null)))
      .catch((e: Error) => vigente && setError(e.message));
    obtenerBonificacionesOtorgadas()
      .then((lista) => vigente && setBonificaciones(lista))
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [recargas]);

  const actualizar = (id: string, cambio: Partial<Muestra> | null) =>
    setMuestras((lista) =>
      (lista ?? []).flatMap((m) => (m.id !== id ? [m] : cambio === null ? [] : [{ ...m, ...cambio }]))
    );

  const cuenta = (f: Filtro) => (muestras ? filtrarMuestras(muestras, f).length : 0);
  const visibles = muestras ? filtrarMuestras(muestras, filtro) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            Administración: muestras de clientes
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Estados de cuenta que no pudimos leer, ya anonimizados en el navegador del cliente. Copia el texto y
            pídele a Claude el lector de ese banco. No lo pegues en issues ni lugares públicos.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Mostrar
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as Filtro)}
              className="mt-1 block rounded-md px-2 py-1.5 text-sm"
              style={estiloEntrada}
            >
              <option value="pendientes">Pendientes ({cuenta("pendientes")})</option>
              {ESTADOS_MUESTRA.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.etiqueta} ({cuenta(e.id)})
                </option>
              ))}
              <option value="todas">Todas ({cuenta("todas")})</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setRecargas((n) => n + 1)}
            className="rounded-md px-3 py-1.5 text-sm"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          No se pudieron cargar las muestras: {error}
        </p>
      )}
      {muestras === null && !error && (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Cargando…
        </p>
      )}
      {muestras !== null && visibles.length === 0 && (
        <p className="tarjeta rounded-lg p-4 text-sm" style={{ color: "var(--text-secondary)" }}>
          {filtro === "pendientes" ? "No hay muestras pendientes." : "No hay muestras con ese estado."}
        </p>
      )}
      {visibles.map((m) => (
        <TarjetaMuestra
          key={m.id}
          muestra={m}
          todas={muestras ?? []}
          bonificaciones={bonificaciones}
          onCambio={(cambio) => actualizar(m.id, cambio)}
        />
      ))}

      {PAGOS_EN_PRUEBA && <ReiniciarPagos />}
      <EmpezarDesdeCero totalMovimientos={totalMovimientos} onDatosBorrados={onDatosBorrados} />
    </div>
  );
}

// Pedido del dueño (2026-10-13): volver a probar el cobro como un cliente
// nuevo. Cancela en Mercado Pago y borra solo las suscripciones propias; con
// eso Mi cuenta vuelve a la prueba gratis (o a Gratis). Solo en modo de prueba.
function ReiniciarPagos() {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "error" | "exito"; texto: string } | null>(null);

  async function reiniciar() {
    setBorrando(true);
    setMensaje(null);
    try {
      const borradas = await reiniciarMisPagos();
      setAbierto(false);
      setTexto("");
      setMensaje({
        tipo: "exito",
        texto:
          borradas === 0
            ? "No tenías suscripciones; tu plan ya está como el de un cliente nuevo."
            : `Listo: se cancelaron y borraron ${borradas === 1 ? "tu suscripción" : `tus ${entero.format(borradas)} suscripciones`}. Abre Mi cuenta para contratar de nuevo.`,
      });
    } catch (e) {
      setMensaje({ tipo: "error", texto: `No se pudieron reiniciar tus pagos: ${(e as Error).message}` });
    } finally {
      setBorrando(false);
    }
  }

  return (
    <section
      className="tarjeta space-y-3 rounded-lg p-4"
      style={{ borderColor: "var(--series-4)" }}
      aria-labelledby="reiniciar-pagos"
    >
      <h3 id="reiniciar-pagos" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Reiniciar pagos (modo de prueba)
      </h3>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Cancela en Mercado Pago tus suscripciones y borra su historial en tu propia cuenta, para volver a probar el
        cobro como un cliente nuevo. Tu plan regresa a la prueba gratis mientras dure (o a Gratis). Tus movimientos no
        se tocan, ni los de ningún cliente.
      </p>
      {!abierto ? (
        <Accion onClick={() => (setAbierto(true), setMensaje(null))} deshabilitado={borrando} peligro>
          Reiniciar mis pagos…
        </Accion>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-48 flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Escribe {PALABRA_BORRAR} para confirmar
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-md px-3 py-2 text-sm"
              style={estiloEntrada}
            />
          </label>
          <Accion onClick={reiniciar} deshabilitado={!confirmaBorrado(texto) || borrando} peligro>
            {borrando ? "Reiniciando…" : "Reiniciar pagos"}
          </Accion>
          <Accion onClick={() => (setAbierto(false), setTexto(""))} deshabilitado={borrando}>
            Cancelar
          </Accion>
        </div>
      )}
      {mensaje && (
        <p
          className="text-sm"
          style={{ color: mensaje.tipo === "error" ? "var(--status-critical)" : "var(--status-good)" }}
          role={mensaje.tipo === "error" ? "alert" : "status"}
        >
          {mensaje.texto}
        </p>
      )}
    </section>
  );
}

// Pedido del dueño (2026-10-12): borrar todo lo cargado para probar desde cero
// sin darse de baja y volver a registrarse. Solo borra lo de su propia sesión.
function EmpezarDesdeCero({
  totalMovimientos,
  onDatosBorrados,
}: {
  totalMovimientos: number;
  onDatosBorrados: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "error" | "exito"; texto: string } | null>(null);

  async function borrar() {
    setBorrando(true);
    setMensaje(null);
    try {
      const borradas = await reiniciarMisDatos();
      setAbierto(false);
      setTexto("");
      setMensaje({
        tipo: "exito",
        texto: `Listo: se borraron ${entero.format(borradas)} movimiento${borradas === 1 ? "" : "s"} con sus cuentas, categorías y eventos.`,
      });
      onDatosBorrados();
    } catch (e) {
      setMensaje({ tipo: "error", texto: `No se pudieron borrar tus datos: ${(e as Error).message}` });
    } finally {
      setBorrando(false);
    }
  }

  return (
    <section
      className="tarjeta space-y-3 rounded-lg p-4"
      style={{ borderColor: "var(--status-critical)" }}
      aria-labelledby="empezar-desde-cero"
    >
      <h3 id="empezar-desde-cero" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Empezar desde cero
      </h3>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Borra todo lo que cargaste en tu propia cuenta ({entero.format(totalMovimientos)} movimiento
        {totalMovimientos === 1 ? "" : "s"}), junto con tus estados de cuenta, cuentas, categorías y eventos. Tu
        cuenta, tu nombre, tus preferencias y las muestras de clientes se quedan. No toca los datos de ningún
        cliente. No se puede deshacer.
      </p>
      {!abierto ? (
        <Accion onClick={() => (setAbierto(true), setMensaje(null))} deshabilitado={borrando} peligro>
          Borrar mis movimientos…
        </Accion>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-48 flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Escribe {PALABRA_BORRAR} para confirmar
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-md px-3 py-2 text-sm"
              style={estiloEntrada}
            />
          </label>
          <Accion onClick={borrar} deshabilitado={!confirmaBorrado(texto) || borrando} peligro>
            {borrando ? "Borrando…" : "Borrar definitivamente"}
          </Accion>
          <Accion onClick={() => (setAbierto(false), setTexto(""))} deshabilitado={borrando}>
            Cancelar
          </Accion>
        </div>
      )}
      {mensaje && (
        <p
          className="text-sm"
          style={{ color: mensaje.tipo === "error" ? "var(--status-critical)" : "var(--status-good)" }}
          role={mensaje.tipo === "error" ? "alert" : "status"}
        >
          {mensaje.texto}
        </p>
      )}
    </section>
  );
}

function TarjetaMuestra({
  muestra,
  todas,
  bonificaciones,
  onCambio,
}: {
  muestra: Muestra;
  todas: readonly Muestra[];
  bonificaciones: readonly BonificacionOtorgada[];
  onCambio: (cambio: Partial<Muestra> | null) => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "error" | "exito"; texto: string } | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  async function cargarTexto(): Promise<string> {
    if (texto !== null) return texto;
    const leido = await obtenerTextoMuestra(muestra.id);
    setTexto(leido);
    return leido;
  }

  async function correr(accion: () => Promise<string | void>) {
    setOcupado(true);
    setMensaje(null);
    try {
      const exito = await accion();
      if (exito) setMensaje({ tipo: "exito", texto: exito });
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  const alternarTexto = () =>
    correr(async () => {
      if (!abierta) await cargarTexto();
      setAbierta((a) => !a);
    });

  const copiar = () =>
    correr(async () => {
      await navigator.clipboard.writeText(textoParaClaude(muestra, await cargarTexto()));
      // Quien copia para revisarla, la está revisando.
      if (muestra.estado === "nueva") {
        await cambiarEstadoMuestra(muestra.id, "en-revision");
        onCambio({ estado: "en-revision" });
      }
      return "Copiado. Pégalo en una conversación con Claude para que proponga el lector.";
    });

  const descargar = () =>
    correr(async () => {
      descargarTexto(
        `muestra-${muestra.creado_en.slice(0, 10)}-${muestra.id.slice(0, 8)}.txt`,
        textoParaClaude(muestra, await cargarTexto()),
        "text/plain;charset=utf-8"
      );
    });

  const cambiarEstado = (estado: EstadoMuestra) =>
    correr(async () => {
      await cambiarEstadoMuestra(muestra.id, estado);
      onCambio({ estado });
    });

  const borrar = () =>
    correr(async () => {
      await borrarMuestra(muestra.id);
      onCambio(null);
    });

  return (
    <section className="tarjeta space-y-3 rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {MOTIVOS_MUESTRA[muestra.motivo]}
            {muestra.banco_detectado && <span style={{ color: "var(--text-secondary)" }}> · {muestra.banco_detectado}</span>}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {fechaHora(muestra.creado_en)} · {muestra.paginas} página{muestra.paginas === 1 ? "" : "s"}
          </p>
          {muestra.comentario && (
            <p className="break-words text-sm" style={{ color: "var(--text-secondary)" }}>
              “{muestra.comentario}”
            </p>
          )}
          {muestra.movimientos_leidos !== null && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              La app sí leyó {entero.format(muestra.movimientos_leidos)} movimientos.
            </p>
          )}
          {muestra.muestra_origen_id && (
            <p className="text-xs" style={{ color: "var(--marca)" }}>
              Retroalimentación: el cliente probó el lector y dice que todavía falta algo
              {(() => {
                const origen = todas.find((m) => m.id === muestra.muestra_origen_id);
                return origen?.clave_cambio ? ` (cambio ${origen.clave_cambio})` : "";
              })()}
              .
            </p>
          )}
          <EstadoRecompensa muestra={muestra} bonificaciones={bonificaciones} />
        </div>
        <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Estado
          <select
            value={muestra.estado}
            onChange={(e) => cambiarEstado(e.target.value as EstadoMuestra)}
            disabled={ocupado}
            className="mt-1 block rounded-md px-2 py-1 text-sm"
            style={estiloEntrada}
          >
            {ESTADOS_MUESTRA.map((e) => (
              <option key={e.id} value={e.id}>
                {e.etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Accion onClick={copiar} deshabilitado={ocupado} principal>
          Copiar para Claude
        </Accion>
        <Accion onClick={alternarTexto} deshabilitado={ocupado}>
          {abierta ? "Ocultar texto" : "Ver texto"}
        </Accion>
        <Accion onClick={descargar} deshabilitado={ocupado}>
          Descargar .txt
        </Accion>
        {confirmarBorrado ? (
          <>
            <Accion onClick={borrar} deshabilitado={ocupado} peligro>
              Sí, borrar
            </Accion>
            <Accion onClick={() => setConfirmarBorrado(false)} deshabilitado={ocupado}>
              Cancelar
            </Accion>
          </>
        ) : (
          <Accion onClick={() => setConfirmarBorrado(true)} deshabilitado={ocupado}>
            Borrar
          </Accion>
        )}
      </div>

      {mensaje && (
        <p
          className="text-xs"
          style={{ color: mensaje.tipo === "error" ? "var(--status-critical)" : "var(--status-good)" }}
          role={mensaje.tipo === "error" ? "alert" : "status"}
        >
          {mensaje.texto}
        </p>
      )}

      <ResolverMuestra muestra={muestra} todas={todas} bonificaciones={bonificaciones} onCambio={onCambio} />

      {abierta && texto !== null && (
        <pre
          className="max-h-96 overflow-auto rounded-md p-3 text-xs leading-snug"
          style={{ background: "var(--page-plane)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        >
          {texto}
        </pre>
      )}
    </section>
  );
}

function EstadoRecompensa({
  muestra,
  bonificaciones,
}: {
  muestra: Muestra;
  bonificaciones: readonly BonificacionOtorgada[];
}) {
  if (!muestra.resultado) return null;
  const etiqueta = RESULTADOS_MUESTRA.find((r) => r.id === muestra.resultado)?.etiqueta;
  const otorgada = bonificaciones.find((b) => b.muestra_id === muestra.id);
  return (
    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
      Resultado: {etiqueta}
      {muestra.clave_cambio && ` · cambio ${muestra.clave_cambio}`}
      {muestra.banco_lector && ` · ${muestra.banco_lector}`}
      {otorgada
        ? ` · regalo otorgado: ${otorgada.meses === 1 ? "1 mes" : `${otorgada.meses} meses`} de ${otorgada.plan_id === "pro" ? "Pro" : "Básico"}`
        : muestra.recompensa
          ? muestra.estado === "confirmada"
            ? " · sin regalo (ese cambio ya se había pagado)"
            : " · con regalo al confirmar"
          : " · sin regalo"}
    </p>
  );
}

/** Resolver la muestra: qué salió de revisarla. Lector nuevo / arreglo con
 * su clave avisan al cliente para que lo pruebe; el regalo solo sale cuando él
 * confirma, y cada clave paga una vez (lo garantiza la base). */
function ResolverMuestra({
  muestra,
  todas,
  bonificaciones,
  onCambio,
}: {
  muestra: Muestra;
  todas: readonly Muestra[];
  bonificaciones: readonly BonificacionOtorgada[];
  onCambio: (cambio: Partial<Muestra>) => void;
}) {
  const origen = todas.find((m) => m.id === muestra.muestra_origen_id);
  const [abierto, setAbierto] = useState(false);
  const [resultado, setResultado] = useState<ResultadoMuestra>(muestra.resultado ?? "lector-nuevo");
  const [clave, setClave] = useState(muestra.clave_cambio ?? origen?.clave_cambio ?? "");
  const [bancoLector, setBancoLector] = useState(
    muestra.banco_lector ?? origen?.banco_lector ?? muestra.banco_detectado ?? ""
  );
  const [recompensa, setRecompensa] = useState(muestra.resultado ? muestra.recompensa : true);
  const [mensaje, setMensaje] = useState(muestra.mensaje_cliente ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (muestra.estado === "confirmada") return null;
  const conRecompensa = RESULTADOS_MUESTRA.find((r) => r.id === resultado)?.recompensa ?? false;
  const claveYaPagada = bonificaciones.some((b) => b.clave_cambio === clave.trim());
  const otraConClave = todas.find(
    (m) => m.id !== muestra.id && m.clave_cambio === clave.trim() && m.user_id !== muestra.user_id && m.recompensa
  );

  async function guardar() {
    const preparada = prepararResolucion({
      resultado,
      clave_cambio: clave,
      banco_lector: bancoLector,
      recompensa,
      mensaje_cliente: mensaje,
    });
    if ("error" in preparada) return setError(preparada.error);
    setOcupado(true);
    setError(null);
    try {
      await resolverMuestra(muestra.id, preparada.cambios);
      onCambio(preparada.cambios);
      setAbierto(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto)
    return (
      <Accion onClick={() => setAbierto(true)} deshabilitado={false}>
        {muestra.resultado ? "Cambiar resultado…" : "Resolver…"}
      </Accion>
    );

  return (
    <div className="space-y-2 rounded-md p-3" style={{ border: "1px solid var(--border)" }}>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Resultado
          <select
            value={resultado}
            onChange={(e) => setResultado(e.target.value as ResultadoMuestra)}
            className="mt-1 block rounded-md px-2 py-1 text-sm"
            style={estiloEntrada}
          >
            {RESULTADOS_MUESTRA.map((r) => (
              <option key={r.id} value={r.id}>
                {r.etiqueta}
              </option>
            ))}
          </select>
        </label>
        {resultado !== "ya-se-leia" && resultado !== "no-sirve" && (
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Banco del lector
            <input
              value={bancoLector}
              onChange={(e) => setBancoLector(e.target.value)}
              list={`bancos-${muestra.id}`}
              className="mt-1 block w-48 rounded-md px-2 py-1 text-sm"
              style={estiloEntrada}
            />
            <datalist id={`bancos-${muestra.id}`}>
              {LECTORES.map((l) => (
                <option key={l.banco} value={l.banco} />
              ))}
            </datalist>
          </label>
        )}
        {conRecompensa && (
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Clave del cambio
            <input
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="bbva-debito"
              className="mt-1 block w-48 rounded-md px-2 py-1 text-sm"
              style={estiloEntrada}
            />
          </label>
        )}
      </div>
      {conRecompensa && (
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={recompensa} onChange={(e) => setRecompensa(e.target.checked)} />
          Dar regalo cuando el cliente confirme que ve todos sus movimientos
        </label>
      )}
      {conRecompensa && recompensa && claveYaPagada && (
        <p className="text-xs" style={{ color: "var(--status-critical)" }}>
          Ese cambio ya se pagó a otro cliente: esta muestra no recibirá regalo.
        </p>
      )}
      {conRecompensa && recompensa && !claveYaPagada && otraConClave && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Otra muestra de otro cliente tiene esa clave con regalo: solo lo recibe quien confirme primero.
        </p>
      )}
      {resultado !== "ya-se-leia" && resultado !== "no-sirve" && (
        <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>
          Mensaje para el cliente (opcional)
          <input
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            maxLength={500}
            placeholder="Ya leemos tus estados de cuenta de BBVA débito."
            className="mt-1 block w-full rounded-md px-2 py-1 text-sm"
            style={estiloEntrada}
          />
        </label>
      )}
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {resultado === "ya-se-leia" || resultado === "no-sirve"
          ? "Se descarta: el cliente no recibe aviso ni regalo."
          : "Publica primero el lector en el sitio. Al guardar, el cliente ve el aviso para subir de nuevo su PDF y confirmar."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Accion onClick={guardar} deshabilitado={ocupado} principal>
          {ocupado ? "Guardando…" : "Guardar resultado"}
        </Accion>
        <Accion onClick={() => setAbierto(false)} deshabilitado={ocupado}>
          Cancelar
        </Accion>
      </div>
      {error && (
        <p className="text-xs" style={{ color: "var(--status-critical)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Accion({
  onClick,
  deshabilitado,
  principal,
  peligro,
  children,
}: {
  onClick: () => void;
  deshabilitado: boolean;
  principal?: boolean;
  peligro?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      style={
        principal
          ? { background: "var(--marca)", color: "white" }
          : {
              border: `1px solid ${peligro ? "var(--status-critical)" : "var(--border)"}`,
              color: peligro ? "var(--status-critical)" : "var(--text-secondary)",
            }
      }
    >
      {children}
    </button>
  );
}
