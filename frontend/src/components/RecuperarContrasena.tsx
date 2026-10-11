import { useState } from "react";
import { supabase } from "../lib/supabase";
import { problemaDeContrasena, traducirErrorAuth } from "../lib/cuentaUsuario";
import { Aviso, BotonEnviar, Campo, EnlaceCuenta, PantallaCuenta } from "./FormularioCuenta";

/** Paso 1: pedir el enlace por correo. Supabase regresa al sitio con
 * `#…type=recovery`, que App detecta (ENLACE_INICIAL) para mostrar el paso 2. */
export function RecuperarContrasena() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    // Sin hash en redirectTo: Supabase agrega el suyo con los tokens.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setCargando(false);
    if (error) setError(traducirErrorAuth(error.message));
    else setEnviado(true);
  }

  return (
    <PantallaCuenta subtitulo="Recupera tu contraseña." onEnviar={enviar}>
      {enviado ? (
        <Aviso tipo="exito">
          Si {email} tiene cuenta, te llegará un enlace para elegir una contraseña nueva. Revisa también spam.
        </Aviso>
      ) : (
        <>
          <Campo etiqueta="Correo" tipo="email" valor={email} onCambiar={setEmail} autoComplete="email" />
          {error && <Aviso tipo="error">{error}</Aviso>}
          <BotonEnviar cargando={cargando} texto="Mandar enlace" textoCargando="Mandando..." />
        </>
      )}
      <p className="mt-4">
        <EnlaceCuenta href="#entrar">← Volver a entrar</EnlaceCuenta>
      </p>
    </PantallaCuenta>
  );
}

/** Paso 2: ya con la sesión de recuperación, elegir la contraseña nueva. */
export function NuevaContrasena({ onListo }: { onListo: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const problema = problemaDeContrasena(password, confirmacion);
    if (problema) return setError(problema);
    setError(null);
    setCargando(true);
    const { error } = await supabase.auth.updateUser({ password });
    setCargando(false);
    if (error) setError(traducirErrorAuth(error.message));
    else onListo();
  }

  return (
    <PantallaCuenta subtitulo="Elige tu contraseña nueva." onEnviar={guardar}>
      <Campo
        etiqueta="Contraseña nueva"
        tipo="password"
        valor={password}
        onCambiar={setPassword}
        autoComplete="new-password"
        ayuda="Al menos 8 caracteres, con letras y números."
      />
      <Campo
        etiqueta="Repite la contraseña"
        tipo="password"
        valor={confirmacion}
        onCambiar={setConfirmacion}
        autoComplete="new-password"
      />
      {error && <Aviso tipo="error">{error}</Aviso>}
      <BotonEnviar cargando={cargando} texto="Guardar y entrar" textoCargando="Guardando..." />
    </PantallaCuenta>
  );
}
