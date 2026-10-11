import { useState } from "react";
import { supabase } from "../lib/supabase";
import { traducirErrorAuth } from "../lib/cuentaUsuario";
import { Aviso, BotonEnviar, Campo, EnlaceCuenta, PantallaCuenta } from "./FormularioCuenta";

/** `producto`: FinanzasPersonales, con los enlaces de registro y recuperación;
 * ahí el Login se muestra flotando sobre la landing page (la ventana pone su
 * propio botón de cerrar). `mensajeInicial`: p. ej. que el enlace del correo
 * ya venció. */
export function Login({ producto = false, mensajeInicial }: { producto?: boolean; mensajeInicial?: string | null } = {}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(mensajeInicial ?? null);
  const [sinConfirmar, setSinConfirmar] = useState(false);
  const [reenviado, setReenviado] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function iniciarSesion(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReenviado(false);
    setCargando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setCargando(false);
    if (error) {
      setError(producto ? traducirErrorAuth(error.message) : error.message);
      setSinConfirmar(/email not confirmed/i.test(error.message));
    }
  }

  async function reenviarConfirmacion() {
    setCargando(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setCargando(false);
    if (error) setError(traducirErrorAuth(error.message));
    else {
      setError(null);
      setReenviado(true);
    }
  }

  return (
    <PantallaCuenta subtitulo="Inicia sesión para ver tus transacciones." onEnviar={iniciarSesion} flotante={producto}>
      <Campo etiqueta="Correo" tipo="email" valor={email} onCambiar={setEmail} autoComplete="email" autoFocus={producto} />
      <Campo
        etiqueta="Contraseña"
        tipo="password"
        valor={password}
        onCambiar={setPassword}
        autoComplete="current-password"
      />

      {error && <Aviso tipo="error">{error}</Aviso>}
      {sinConfirmar && !reenviado && (
        <p className="mt-2">
          <EnlaceCuenta onClick={reenviarConfirmacion}>Reenviar el correo de confirmación</EnlaceCuenta>
        </p>
      )}
      {reenviado && <Aviso tipo="exito">Listo: te mandamos otro correo a {email}.</Aviso>}

      <BotonEnviar cargando={cargando} texto="Entrar" textoCargando="Entrando..." />

      {producto && (
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <EnlaceCuenta href="#recuperar">¿Olvidaste tu contraseña?</EnlaceCuenta>
          <EnlaceCuenta href="#registro">Crear cuenta</EnlaceCuenta>
        </div>
      )}
    </PantallaCuenta>
  );
}
