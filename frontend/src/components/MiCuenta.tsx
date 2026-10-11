import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
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
import { fechaCorta } from "../lib/formato";
import type { Transaccion } from "../lib/types";

// "Mi cuenta" de FinanzasPersonales (fase 1): perfil, plan, contraseña,
// exportar los datos y borrar la cuenta. Cambiar o cancelar el plan llega con
// los cobros (fase 3).

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
      <Seccion titulo="Plan">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          Beta gratuita: tienes todas las funciones mientras dure la beta.
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          Cuando lleguen los planes de pago te avisaremos antes de cobrar cualquier cosa, y aquí podrás cambiar o
          cancelar tu plan.
        </p>
      </Seccion>
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
        Borra tu cuenta ({correo}) y todos tus datos: movimientos, cuentas, categorías, eventos y preferencias. No
        se puede deshacer. Si quieres conservar tus movimientos, descárgalos antes.
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
