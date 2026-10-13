import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { REGRESO_DE_PAGO, supabase } from "../lib/supabase";
import { borrarMiCuenta, guardarNombre, obtenerPerfil, type Perfil } from "../lib/perfil";
import {
  confirmaBorrado,
  PALABRA_BORRAR,
  problemaDeContrasena,
  traducirErrorAuth,
  VERSION_TERMINOS,
} from "../lib/cuentaUsuario";
import { descargarTexto, nombreArchivoExportacion, transaccionesACsv } from "../lib/exportarDatos";
import { hoyIso } from "../lib/fechas";
import { fechaCorta, moneda } from "../lib/formato";
import type { Transaccion } from "../lib/types";
import { ahorroAnual, PLANES, precioPorMes, type Periodo, type Plan } from "../lib/planes";
import {
  cancelarSuscripcion,
  describirPlan,
  iniciarSuscripcion,
  LLAVE_PUBLICA_MP,
  nombreDePlan,
  leerPlanYSuscripciones,
  obtenerSuscripciones,
  PAGOS_EN_PRUEBA,
  pagoConfirmado,
  suscripcionViva,
  type MiPlan,
  type Suscripcion,
} from "../lib/suscripcion";
import { Segmentado } from "./Segmentado";

const PagoConTarjeta = lazy(() => import("./PagoConTarjeta"));

// "Mi cuenta" de FinanzasPersonales (fase 1): perfil, plan, contraseña,
// exportar los datos y borrar la cuenta. El plan se paga con Mercado Pago
// (fase 3): aquí se elige, se cancela y se ve el próximo cobro, porque
// Mercado Pago no tiene un portal de cliente.

const estiloEntrada = {
  background: "var(--page-plane)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};

export function MiCuenta({ correo, transacciones }: { correo: string; transacciones: Transaccion[] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        Mi cuenta
      </h2>
      <SeccionPerfil correo={correo} />
      <SeccionPlan correo={correo} />
      <SeccionContrasena />
      <SeccionExportar transacciones={transacciones} />
      <SeccionBorrar correo={correo} />
    </div>
  );
}

function Seccion({ titulo, children, peligro }: { titulo: string; children: ReactNode; peligro?: boolean }) {
  return (
    <section
      className="tarjeta rounded-lg p-4 sm:p-5"
      style={peligro ? { borderColor: "var(--status-critical)" } : undefined}
    >
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Mensaje({ tipo, children }: { tipo: "error" | "exito"; children: ReactNode }) {
  return (
    <p
      role={tipo === "error" ? "alert" : "status"}
      className="mt-2 text-sm"
      style={{ color: tipo === "error" ? "var(--status-critical)" : "var(--status-good)" }}
    >
      {children}
    </p>
  );
}

function Boton({
  children,
  onClick,
  deshabilitado,
  peligro,
  tipo = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  deshabilitado?: boolean;
  peligro?: boolean;
  tipo?: "button" | "submit";
}) {
  return (
    <button
      type={tipo}
      onClick={onClick}
      disabled={deshabilitado}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      style={{ background: peligro ? "var(--status-critical)" : "var(--series-1)" }}
    >
      {children}
    </button>
  );
}

function SeccionPerfil({ correo }: { correo: string }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    obtenerPerfil()
      .then((p) => {
        setPerfil(p);
        setNombre(p?.nombre ?? "");
      })
      .catch((e: Error) => setError(`No se pudo leer tu perfil: ${e.message}`));
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      await guardarNombre(nombre);
      setGuardado(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Seccion titulo="Perfil">
      <form onSubmit={guardar} className="flex flex-wrap items-end gap-2">
        <label className="block min-w-48 flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Nombre
          <input
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value);
              setGuardado(false);
            }}
            autoComplete="name"
            className="mt-1 w-full rounded-md px-3 py-2 text-sm"
            style={estiloEntrada}
          />
        </label>
        <Boton tipo="submit" deshabilitado={guardando}>
          {guardando ? "Guardando..." : "Guardar"}
        </Boton>
      </form>
      {guardado && <Mensaje tipo="exito">Nombre guardado.</Mensaje>}
      {error && <Mensaje tipo="error">{error}</Mensaje>}
      <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
        <dt style={{ color: "var(--text-muted)" }}>Correo</dt>
        <dd style={{ color: "var(--text-primary)" }}>{correo}</dd>
        <dt style={{ color: "var(--text-muted)" }}>Términos aceptados</dt>
        <dd style={{ color: "var(--text-primary)" }}>
          {perfil?.terminos_aceptados_en
            ? `Versión ${perfil.terminos_version} el ${fechaCorta(perfil.terminos_aceptados_en.slice(0, 10))}`
            : "—"}
          {perfil?.terminos_version && perfil.terminos_version !== VERSION_TERMINOS && " (hay una versión más nueva)"}
          {" · "}
          <a href="#terminos" target="_blank" rel="noopener" style={{ color: "var(--series-1)" }}>Términos</a>
          {" · "}
          <a href="#privacidad" target="_blank" rel="noopener" style={{ color: "var(--series-1)" }}>Privacidad</a>
        </dd>
      </dl>
    </Seccion>
  );
}

// Al volver de pagar, Mercado Pago tarda unos segundos en avisar al webhook:
// mientras, se consulta la suscripción cada INTERVALO_CONFIRMACION ms.
const INTERVALO_CONFIRMACION = 3000;
const INTENTOS_CONFIRMACION = 20;
// El regreso se atiende una sola vez: al confirmarse (o rendirse) ya no se
// vuelve a esperar aunque se salga y se vuelva a Mi cuenta.
let regresoPendiente = REGRESO_DE_PAGO;

type Confirmacion = "esperando" | "confirmado" | "sin-confirmar" | null;

// Aviso que reemplaza al formulario de tarjeta en el mismo lugar cuando el pago
// termina: el cliente está mirando ahí, no arriba de la sección.
function PagoTerminado({
  plan,
  periodo,
  activa,
  viva,
  onCerrar,
}: {
  plan: Plan;
  periodo: Periodo;
  activa: boolean;
  viva: Suscripcion | null;
  onCerrar: () => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    caja.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    caja.current?.focus({ preventScroll: true });
  }, []);
  const proximo = activa && viva?.plan_id === plan.id && viva.periodo_fin ? viva : null;
  return (
    <div
      ref={caja}
      tabIndex={-1}
      role="status"
      className="mt-4 rounded-lg p-4 outline-none"
      style={{
        border: `1px solid ${activa ? "var(--status-good)" : "var(--series-4)"}`,
        background: "var(--page-plane)",
      }}
    >
      <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        {activa ? `✓ ¡Pago confirmado! Ya tienes el plan ${plan.nombre} ${periodo}.` : "Recibimos tu pago"}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        {activa
          ? proximo
            ? `Próximo cobro: ${moneda.format(proximo.monto)} el ${fechaCorta(proximo.periodo_fin!.slice(0, 10))}`
            : "Ya puedes usar todo lo que incluye."
          : `Mercado Pago todavía lo está confirmando. Tu plan ${plan.nombre} se activará solo en unos minutos; vuelve a abrir Mi cuenta para verlo.`}
      </p>
      <div className="mt-3">
        <Boton onClick={onCerrar}>Entendido</Boton>
      </div>
    </div>
  );
}

function SeccionPlan({ correo }: { correo: string }) {
  const [miPlan, setMiPlan] = useState<MiPlan | null>(null);
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [periodo, setPeriodo] = useState<Periodo>("anual");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  // Lo que se canceló, para decir hasta cuándo conserva el plan.
  const [cancelada, setCancelada] = useState<Suscripcion | null>(null);
  const [errorCancelar, setErrorCancelar] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<Confirmacion>(() => (regresoPendiente ? "esperando" : null));
  // Plan cuyo formulario de tarjeta embebido está abierto.
  const [pagando, setPagando] = useState<Plan | null>(null);
  const [pagado, setPagado] = useState<{ plan: Plan; periodo: Periodo; activa: boolean } | null>(null);

  const cargar = useCallback(async () => {
    const { plan, lista } = await leerPlanYSuscripciones();
    setMiPlan(plan);
    setSuscripciones(lista);
    return lista;
  }, []);

  useEffect(() => {
    leerPlanYSuscripciones()
      .then(({ plan, lista }) => {
        setMiPlan(plan);
        setSuscripciones(lista);
      })
      .catch((e: Error) => setError(`No se pudo leer tu plan: ${e.message}`));
  }, []);

  useEffect(() => {
    const regreso = regresoPendiente;
    if (!regreso) return;
    let intentos = 0;
    let vivo = true;
    const revisar = async () => {
      if (!vivo) return;
      intentos++;
      const lista = await cargar().catch(() => null);
      if (!vivo) return;
      const confirmado = lista !== null && pagoConfirmado(lista, regreso.preapprovalId);
      if (confirmado || intentos >= INTENTOS_CONFIRMACION) {
        regresoPendiente = null;
        // El plan se leyó junto con la lista; se relee ya con el pago firme.
        if (confirmado) void cargar().catch(() => undefined);
        return setConfirmacion(confirmado ? "confirmado" : "sin-confirmar");
      }
      setTimeout(revisar, INTERVALO_CONFIRMACION);
    };
    void revisar();
    return () => {
      vivo = false;
    };
  }, [cargar]);

  const viva = suscripcionViva(suscripciones);

  async function suscribir(plan: Plan) {
    if (plan.id === "gratis") return;
    setError(null);
    if (LLAVE_PUBLICA_MP) {
      setConfirmacion(null);
      setCancelada(null);
      setPagado(null);
      return setPagando(plan);
    }
    setEnviando(plan.id);
    try {
      window.location.assign(await iniciarSuscripcion(plan.id, periodo));
    } catch (e) {
      setError((e as Error).message);
      setEnviando(null);
    }
  }

  async function cancelar() {
    if (!viva) return;
    const anterior = viva;
    setErrorCancelar(null);
    setEnviando("cancelar");
    try {
      await cancelarSuscripcion();
      setConfirmarCancelar(false);
      setConfirmacion(null);
      setPagado(null);
      setCancelada(anterior);
      await cargar();
    } catch (e) {
      setErrorCancelar(
        `No se pudo cancelar: ${(e as Error).message}. Tu suscripción sigue activa; inténtalo de nuevo en un momento.`
      );
    } finally {
      setEnviando(null);
    }
  }

  return (
    <Seccion titulo="Plan">
      {PAGOS_EN_PRUEBA && (
        <p
          className="mb-3 rounded-md px-3 py-2 text-xs"
          style={{ background: "var(--page-plane)", border: "1px dashed var(--series-4)", color: "var(--text-secondary)" }}
        >
          <strong style={{ color: "var(--text-primary)" }}>Modo de prueba:</strong> los pagos usan cuentas de prueba de
          Mercado Pago y no se cobra nada real.
        </p>
      )}
      {confirmacion === "esperando" && <Mensaje tipo="exito">Confirmando tu pago con Mercado Pago…</Mensaje>}
      {confirmacion === "confirmado" && (
        <Mensaje tipo="exito">¡Listo! Tu pago quedó confirmado y tu plan ya está activo.</Mensaje>
      )}
      {confirmacion === "sin-confirmar" && (
        <Mensaje tipo="error">
          Mercado Pago todavía no nos confirma el pago. Si lo completaste, tu plan se activará solo en unos minutos;
          vuelve a abrir Mi cuenta para verlo.
        </Mensaje>
      )}
      <p className="mt-1 text-sm" style={{ color: "var(--text-primary)" }}>
        {miPlan ? describirPlan(miPlan, new Date()) : "Leyendo tu plan…"}
      </p>
      {viva && (
        <div className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          {viva.periodo_fin && (
            <p>
              Próximo cobro: {moneda.format(viva.monto)} el {fechaCorta(viva.periodo_fin.slice(0, 10))}
              {viva.estado === "pausada" && " (pausada en Mercado Pago)"}.
            </p>
          )}
          {!confirmarCancelar ? (
            <button
              type="button"
              onClick={() => {
                setErrorCancelar(null);
                setConfirmarCancelar(true);
              }}
              className="mt-2 text-sm underline"
              style={{ color: "var(--status-critical)" }}
            >
              Cancelar suscripción
            </button>
          ) : (
            <div
              className="mt-3 rounded-lg p-4"
              style={{ border: "1px solid var(--status-critical)", background: "var(--page-plane)" }}
            >
              <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                ¿Cancelar tu plan {nombreDePlan(viva.plan_id)} {viva.periodo}?
              </p>
              <ul className="mt-2 space-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                <li>• No se te volverá a cobrar.</li>
                <li>
                  • Sigues con {nombreDePlan(viva.plan_id)}
                  {viva.periodo_fin ? ` hasta el ${fechaCorta(viva.periodo_fin.slice(0, 10))}` : " hasta el fin del periodo pagado"};
                  después pasas al plan Gratis.
                </li>
                <li>• Tus movimientos y cuentas no se borran.</li>
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Boton deshabilitado={enviando === "cancelar"} onClick={() => setConfirmarCancelar(false)}>
                  Mantener mi plan
                </Boton>
                <button
                  type="button"
                  disabled={enviando === "cancelar"}
                  onClick={() => void cancelar()}
                  className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  style={{ border: "1px solid var(--status-critical)", color: "var(--status-critical)" }}
                >
                  {enviando === "cancelar" ? "Cancelando…" : "Sí, cancelar"}
                </button>
              </div>
              {errorCancelar && <Mensaje tipo="error">{errorCancelar}</Mensaje>}
            </div>
          )}
        </div>
      )}
      {cancelada && (
        <div
          role="status"
          className="mt-3 rounded-lg p-4"
          style={{ border: "1px solid var(--status-good)", background: "var(--page-plane)" }}
        >
          <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            ✓ Suscripción cancelada. No habrá más cobros.
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            {cancelada.periodo_fin
              ? `Sigues con ${nombreDePlan(cancelada.plan_id)} hasta el ${fechaCorta(cancelada.periodo_fin.slice(0, 10))}. `
              : ""}
            Si cambias de opinión, puedes volver a suscribirte cuando quieras.
          </p>
          <div className="mt-3">
            <Boton onClick={() => setCancelada(null)}>Entendido</Boton>
          </div>
        </div>
      )}


      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {viva ? "Cambiar de plan" : "Elige un plan"}
        </p>
        <Segmentado<Periodo>
          opciones={[
            { id: "anual", etiqueta: "Anual" },
            { id: "mensual", etiqueta: "Mensual" },
          ]}
          valor={periodo}
          onCambiar={(p) => {
            setPeriodo(p);
            setPagando(null);
            setPagado(null);
          }}
          chico
        />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {PLANES.filter((p) => p.id !== "gratis").map((plan) => {
          const esElActual = viva?.plan_id === plan.id && viva.periodo === periodo;
          return (
            <div
              key={plan.id}
              className="rounded-lg p-3"
              style={{ border: `1px solid ${plan.destacado ? "var(--series-1)" : "var(--border)"}` }}
            >
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {plan.nombre}
              </p>
              <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                {moneda.format(periodo === "anual" ? plan.precioAnual! : plan.precioMensual)}
                <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                  {periodo === "anual"
                    ? ` al año (${moneda.format(Math.round(precioPorMes(plan, "anual")))} al mes, ahorras ${moneda.format(ahorroAnual(plan))})`
                    : " al mes"}
                </span>
              </p>
              <ul className="mt-2 space-y-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                {plan.incluye.map((linea) => (
                  <li key={linea}>✓ {linea}</li>
                ))}
              </ul>
              <div className="mt-3">
                <Boton
                  deshabilitado={esElActual || enviando !== null || pagando?.id === plan.id}
                  onClick={() => void suscribir(plan)}
                >
                  {esElActual
                    ? "Tu plan actual"
                    : enviando === plan.id
                      ? "Abriendo Mercado Pago..."
                      : viva
                        ? `Cambiar a ${plan.nombre}`
                        : "Suscribirme"}
                </Boton>
              </div>
            </div>
          );
        })}
      </div>
      {pagando && (
        <Suspense
          fallback={
            <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
              Cargando el formulario de pago…
            </p>
          }
        >
          <PagoConTarjeta
            plan={pagando}
            periodo={periodo}
            monto={periodo === "anual" ? pagando.precioAnual! : pagando.precioMensual}
            correo={correo}
            onCancelar={() => setPagando(null)}
            onPagado={(activa) => {
              setPagado({ plan: pagando, periodo, activa });
              setPagando(null);
              void cargar().catch(() => undefined);
            }}
          />
        </Suspense>
      )}
      {pagado && (
        <PagoTerminado
          plan={pagado.plan}
          periodo={pagado.periodo}
          activa={pagado.activa}
          viva={viva}
          onCerrar={() => setPagado(null)}
        />
      )}
      <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {LLAVE_PUBLICA_MP ? "Pagas con tarjeta aquí mismo, procesado por Mercado Pago" : "Pagas en Mercado Pago con tarjeta o saldo"}; el cobro se repite cada {periodo === "anual" ? "año" : "mes"} hasta
        que canceles aquí.{viva ? " Al pagar el plan nuevo, el anterior deja de cobrarse." : ""}
        {!viva && miPlan?.origen === "suscripcion" && miPlan.vigente_hasta
          ? " Si te suscribes de nuevo antes de que termine tu plan cancelado, el cobro empieza hoy."
          : ""}
      </p>
      {error && <Mensaje tipo="error">{error}</Mensaje>}
    </Seccion>
  );
}

function SeccionContrasena() {
  const [password, setPassword] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function cambiar(e: React.FormEvent) {
    e.preventDefault();
    setListo(false);
    const problema = problemaDeContrasena(password, confirmacion);
    if (problema) return setError(problema);
    setError(null);
    setGuardando(true);
    const { error } = await supabase.auth.updateUser({ password });
    setGuardando(false);
    if (error) return setError(traducirErrorAuth(error.message));
    setPassword("");
    setConfirmacion("");
    setListo(true);
  }

  return (
    <Seccion titulo="Contraseña">
      <form onSubmit={cambiar} className="flex flex-wrap items-end gap-2">
        {[
          { etiqueta: "Contraseña nueva", valor: password, cambiar: setPassword },
          { etiqueta: "Repítela", valor: confirmacion, cambiar: setConfirmacion },
        ].map((c) => (
          <label key={c.etiqueta} className="block min-w-40 flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            {c.etiqueta}
            <input
              type="password"
              required
              value={c.valor}
              autoComplete="new-password"
              onChange={(e) => c.cambiar(e.target.value)}
              className="mt-1 w-full rounded-md px-3 py-2 text-sm"
              style={estiloEntrada}
            />
          </label>
        ))}
        <Boton tipo="submit" deshabilitado={guardando}>
          {guardando ? "Cambiando..." : "Cambiar"}
        </Boton>
      </form>
      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Al menos 8 caracteres, con letras y números.
      </p>
      {listo && <Mensaje tipo="exito">Contraseña cambiada.</Mensaje>}
      {error && <Mensaje tipo="error">{error}</Mensaje>}
    </Seccion>
  );
}

function SeccionExportar({ transacciones }: { transacciones: Transaccion[] }) {
  return (
    <Seccion titulo="Exportar mis datos">
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Descarga todos tus movimientos ({transacciones.length.toLocaleString("es-MX")}) en un archivo CSV que abre
        Excel: fecha, descripción, monto, tipo, categoría, comercio, evento, cuenta, banco y tarjeta.
      </p>
      <div className="mt-3">
        <Boton
          deshabilitado={transacciones.length === 0}
          onClick={() => descargarTexto(nombreArchivoExportacion(hoyIso()), transaccionesACsv(transacciones))}
        >
          Descargar CSV
        </Boton>
      </div>
    </Seccion>
  );
}

function SeccionBorrar({ correo }: { correo: string }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function borrar() {
    setBorrando(true);
    setError(null);
    try {
      // Que no quede un cobro recurrente vivo en Mercado Pago (la base se
      // niega a borrar mientras haya una suscripción activa).
      if (suscripcionViva(await obtenerSuscripciones())) await cancelarSuscripcion();
      await borrarMiCuenta();
      // La cuenta ya no existe: solo queda olvidar la sesión en este navegador.
      await supabase.auth.signOut({ scope: "local" });
    } catch (err) {
      setError(`No se pudo borrar la cuenta: ${(err as Error).message}`);
      setBorrando(false);
    }
  }

  return (
    <Seccion titulo="Borrar mi cuenta" peligro>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Borra tu cuenta ({correo}) y todos tus datos: movimientos, cuentas, categorías, eventos y preferencias. Si
        tienes una suscripción, se cancela. No se puede deshacer. Si quieres conservar tus movimientos, descárgalos antes.
      </p>
      {!abierto ? (
        <div className="mt-3">
          <Boton peligro onClick={() => setAbierto(true)}>
            Borrar mi cuenta…
          </Boton>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
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
          <Boton peligro deshabilitado={!confirmaBorrado(texto) || borrando} onClick={borrar}>
            {borrando ? "Borrando..." : "Borrar definitivamente"}
          </Boton>
          <button
            type="button"
            onClick={() => {
              setAbierto(false);
              setTexto("");
            }}
            className="px-2 py-1.5 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            Cancelar
          </button>
        </div>
      )}
      {error && <Mensaje tipo="error">{error}</Mensaje>}
    </Seccion>
  );
}
