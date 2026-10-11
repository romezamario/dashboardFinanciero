import { lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { Landing } from "./components/Landing";
import { EDICION } from "./lib/edicion";

// Dashboard (y todo lo que arrastra: Recharts, indicadores.ts, cada gráfica)
// es la mayor parte del bundle -- separarlo del de Login hace que la
// pantalla de login no tenga que esperar a que se descargue/parsee ese
// código, que no usa hasta después de iniciar sesión.
const Dashboard = lazy(() =>
  import("./components/Dashboard").then((m) => ({ default: m.Dashboard }))
);

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  // Solo en FinanzasPersonales: sin sesión se ve primero la landing page, y
  // "#entrar" muestra el Login (así el botón Atrás del navegador regresa).
  const [enLogin, setEnLogin] = useState(() => window.location.hash === "#entrar");

  useEffect(() => {
    const alCambiarHash = () => setEnLogin(window.location.hash === "#entrar");
    window.addEventListener("hashchange", alCambiarHash);
    return () => window.removeEventListener("hashchange", alCambiarHash);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCargandoSesion(false);
    });

    const { data: suscripcion } = supabase.auth.onAuthStateChange(
      (_evento, nuevaSesion) => {
        setSession(nuevaSesion);
      }
    );

    return () => suscripcion.subscription.unsubscribe();
  }, []);

  if (cargandoSesion) return null;

  if (!session) {
    if (EDICION === "personal") return <Login />;
    if (!enLogin) return <Landing onEntrar={() => { window.location.hash = "entrar"; }} />;
    return <Login onVolver={() => window.history.back()} />;
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
      <Dashboard />
    </Suspense>
  );
}
