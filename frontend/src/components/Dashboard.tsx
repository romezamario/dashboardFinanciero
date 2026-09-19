import { useEffect, useState } from "react";
import {
  agruparGastoPorCategoria,
  agruparIngresosGastosPorMes,
  agruparTendenciaSaldo,
  calcularTotales,
  obtenerTransacciones,
} from "../lib/queries";
import type { Transaccion } from "../lib/types";
import { supabase } from "../lib/supabase";
import { StatTile } from "./StatTile";
import { IngresosGastosChart } from "./IngresosGastosChart";
import { GastoPorCategoriaChart } from "./GastoPorCategoriaChart";
import { TendenciaSaldoChart } from "./TendenciaSaldoChart";
import { TransaccionesTabla } from "./TransaccionesTabla";

export function Dashboard() {
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    obtenerTransacciones()
      .then(setTransacciones)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <CentroDePagina>
        <p style={{ color: "var(--text-secondary)" }}>Cargando…</p>
      </CentroDePagina>
    );
  }

  if (error) {
    return (
      <CentroDePagina>
        <p style={{ color: "var(--status-critical)" }}>
          No se pudieron cargar las transacciones: {error}
        </p>
      </CentroDePagina>
    );
  }

  const totales = calcularTotales(transacciones);
  const ingresosGastos = agruparIngresosGastosPorMes(transacciones);
  const gastoPorCategoria = agruparGastoPorCategoria(transacciones);
  const { puntos: puntosSaldo, cuentas } = agruparTendenciaSaldo(transacciones);

  return (
    <div style={{ background: "var(--page-plane)", minHeight: "100vh" }}>
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <h1
          className="text-lg font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Dashboard Financiero
        </h1>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          Cerrar sesión
        </button>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-6">
        {transacciones.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>
            No hay transacciones sincronizadas todavía — usa la app de
            escritorio para procesar un estado de cuenta y sincronizarlo.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile label="Saldo actual" value={totales.saldoActual} />
              <StatTile
                label="Ingresos del mes"
                value={totales.ingresosMes}
                tone="good"
              />
              <StatTile
                label="Gastos del mes"
                value={totales.gastosMes}
                tone="critical"
              />
            </div>

            <IngresosGastosChart datos={ingresosGastos} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <GastoPorCategoriaChart datos={gastoPorCategoria} />
              <TendenciaSaldoChart puntos={puntosSaldo} cuentas={cuentas} />
            </div>

            <TransaccionesTabla transacciones={transacciones} />
          </>
        )}
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
