import { useState } from "react";
import { supabase } from "../lib/supabase";
import { problemaDeContrasena, traducirErrorAuth, VERSION_TERMINOS } from "../lib/cuentaUsuario";
import { Aviso, BotonEnviar, Campo, EnlaceCuenta, PantallaCuenta } from "./FormularioCuenta";

// Registro de FinanzasPersonales. Supabase manda un correo de confirmación y
// no deja entrar hasta abrirlo ("Confirm email" en Authentication → Sign In /
// Providers → Email). El nombre y la versión de los términos viajan en
// `options.data` y el trigger crear_perfil_de_usuario los guarda en `perfiles`.

export function Registro() {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [enviadoA, setEnviadoA] = useState<string | null>(null);

  async function registrarse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problema = problemaDeContrasena(password, confirmacion);
    if (problema) return setError(problema);
    if (!acepta) return setError("Para crear tu cuenta necesitas aceptar los términos y el aviso de privacidad.");

    setCargando(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { nombre: nombre.trim(), terminos_version: VERSION_TERMINOS },
      },
    });
    setCargando(false);
    if (error) return setError(traducirErrorAuth(error.message));
    // Si el proyecto no pidiera confirmación, signUp ya trae sesión y App
    // pasa directo al tablero; si la pide, toca revisar el correo.
    if (!data.session) setEnviadoA(email);
  }

  if (enviadoA) {
    return (
      <PantallaCuenta subtitulo="Revisa tu correo">
        <p className="mt-4 text-sm" style={{ color: "var(--text-primary)" }}>
          Te mandamos un enlace a <strong>{enviadoA}</strong>. Ábrelo para confirmar tu cuenta y entrar.
        </p>
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Si no llega en unos minutos, busca en spam o correo no deseado. Si ese correo ya tenía cuenta, no
          llegará nada nuevo: entra o recupera tu contraseña.
        </p>
        <p className="mt-4">
          <EnlaceCuenta href="#entrar">Ir a entrar</EnlaceCuenta>
        </p>
      </PantallaCuenta>
    );
  }

  return (
    <PantallaCuenta subtitulo="Crea tu cuenta gratis." onEnviar={registrarse}>
      <Campo etiqueta="Nombre" valor={nombre} onCambiar={setNombre} autoComplete="name" />
      <Campo etiqueta="Correo" tipo="email" valor={email} onCambiar={setEmail} autoComplete="email" />
      <Campo
        etiqueta="Contraseña"
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

      <label className="mt-4 flex items-start gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="mt-1" />
        <span>
          Acepto los{" "}
          <a href="#terminos" target="_blank" rel="noopener" style={{ color: "var(--series-1)" }}>
            términos de servicio
          </a>{" "}
          y el{" "}
          <a href="#privacidad" target="_blank" rel="noopener" style={{ color: "var(--series-1)" }}>
            aviso de privacidad
          </a>
          .
        </span>
      </label>

      {error && <Aviso tipo="error">{error}</Aviso>}

      <BotonEnviar cargando={cargando} texto="Crear cuenta" textoCargando="Creando..." />

      <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>
        ¿Ya tienes cuenta? <EnlaceCuenta href="#entrar">Entra</EnlaceCuenta>
      </p>
    </PantallaCuenta>
  );
}
