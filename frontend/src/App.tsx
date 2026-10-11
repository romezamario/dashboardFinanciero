import { lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ENLACE_INICIAL, supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { Landing } from "./components/Landing";
import { Registro } from "./components/Registro";
import { NuevaContrasena, RecuperarContrasena } from "./components/RecuperarContrasena";
import { Legal } from "./components/Legal";
import { EDICION } from "./lib/edicion";
import { rutaDeHash, type RutaPublica } from "./lib/cuentaUsuario";

// Dashboard (y todo lo que arrastra: Recharts, indicadores.ts, cada gráfica)
// es la mayor parte del bundle -- separarlo del de Login hace que la
// pantalla de login no tenga que esperar a que se descargue/parsee ese
// código, que no usa hasta después de iniciar sesión.
const Dashboard = lazy(() =>
  import("./components/Dashboard").then((m) => ({ default: m.Dashboard }))
);

function irA(ruta: RutaPublica) {
  window.location.hash = ruta === "inicio" ? "" : ruta;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  // Solo en FinanzasPersonales: el hash elige la pantalla pública (landing,
  // entrar, registro, recuperar, términos, privacidad), así el botón Atrás
  // del navegador funciona sin un enrutador.
  const [ruta, setRuta] = useState<RutaPublica>(() =>
    ENLACE_INICIAL.error ? "entrar" : rutaDeHash(window.location.hash)
  );
  // Llegó desde el correo de "Recuperar contraseña": antes del tablero, pedir
  // la contraseña nueva.
  const [recuperando, setRecuperando] = useState(ENLACE_INICIAL.recuperacion);

  useEffect(() => {
    const alCambiarHash = () => setRuta(rutaDeHash(window.location.hash));
    window.addEventListener("hashchange", alCambiarHash);
    return () => window.removeEventListener("hashchange", alCambiarHash);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCargandoSesion(false);
    });

    const { data: suscripcion } = supabase.auth.onAuthStateChange(
      (evento, nuevaSesion) => {
        setSession(nuevaSesion);
        if (evento === "PASSWORD_RECOVERY") setRecuperando(true);
      }
    );

    return () => suscripcion.subscription.unsubscribe();
  }, []);

  if (cargandoSesion) return null;

  if (EDICION === "personal" && !session) return <Login />;

  if (EDICION === "producto") {
    // Términos y privacidad se ven con o sin sesión (enlaces desde Mi cuenta).
    if (ruta === "terminos" || ruta === "privacidad")
      return <Legal documento={ruta} onVolver={() => irA("inicio")} />;

    if (session && recuperando) return <NuevaContrasena onListo={() => setRecuperando(false)} />;

    if (!session) {
      switch (ruta) {
        case "registro":
          return <Registro />;
        case "recuperar":
          return <RecuperarContrasena />;
        default:
          // "#entrar" es la misma landing con el Login flotando junto al
          // botón "Entrar" (Mario, 2026-10-11: no una página aparte).
          return (
            <Landing
              onEntrar={() => irA("entrar")}
              onRegistrarse={() => irA("registro")}
              login={
                ruta === "entrar" ? <Login producto mensajeInicial={ENLACE_INICIAL.error} /> : null
              }
              onCerrarLogin={() => irA("inicio")}
            />
          );
      }
    }
  }

  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-screen items-center justify-center"
          style={{ background: "var(--page-plane)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Cargando…</p>
        </div>
      }
    >
      <Dashboard correo={session?.user.email ?? ""} />
    </Suspense>
  );
}
