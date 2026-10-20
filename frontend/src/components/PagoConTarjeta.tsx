// Formulario de tarjeta de Mercado Pago (Card Payment Brick) dentro de Mi
// cuenta: el cliente paga sin salir del sitio. El número de tarjeta lo captura
// el iframe de Mercado Pago y a nosotros solo llega un token de un solo uso,
// que crear-suscripcion usa para dejar la suscripción autorizada. Se carga en
// su propio chunk (el SDK de Mercado Pago solo se descarga al pagar).
import { CardPayment, initMercadoPago } from "@mercadopago/sdk-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { moneda } from "../lib/formato";
import type { Periodo, Plan } from "../lib/planes";
import { LLAVE_PUBLICA_MP, suscribirConTarjeta } from "../lib/suscripcion";

let iniciado = false;
function iniciar() {
  if (iniciado || !LLAVE_PUBLICA_MP) return;
  initMercadoPago(LLAVE_PUBLICA_MP, { locale: "es-MX" });
  iniciado = true;
}

function temaOscuro(): boolean {
  const forzado = document.documentElement.getAttribute("data-theme");
  if (forzado) return forzado === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export default function PagoConTarjeta({
  plan,
  periodo,
  monto,
  correo,
  onPagado,
  onCancelar,
}: {
  plan: Plan;
  periodo: Periodo;
  monto: number;
  correo: string | null;
  onPagado: (activa: boolean) => void;
  onCancelar: () => void;
}) {
  iniciar();
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  // Un formulario nuevo por intento: el token de un intento fallido ya no sirve.
  const [intento, setIntento] = useState(0);
  const [procesando, setProcesando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  // Al abrirse, el formulario queda a la vista (aparece debajo de los planes).
  useEffect(() => {
    caja.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  // El Brick se vuelve a montar cada vez que cambia la identidad de cualquiera
  // de sus props (useEffect interno de @mercadopago/sdk-react): todo lo que se
  // le pasa es estable, y los datos que cambian se leen por ref.
  const alPagar = useRef(onPagado);
  useEffect(() => {
    alPagar.current = onPagado;
  }, [onPagado]);
  const idPlan = plan.id;
  const inicializacion = useMemo(() => ({ amount: monto, payer: correo ? { email: correo } : undefined }), [monto, correo]);
  const personalizacion = useMemo(
    () => ({
      paymentMethods: { maxInstallments: 1 },
      visual: { style: { theme: temaOscuro() ? ("dark" as const) : ("default" as const) } },
    }),
    []
  );
  const alEstarListo = useCallback(() => setListo(true), []);
  const alFallar = useCallback((e: { message: string }) => setError(`El formulario de pago falló: ${e.message}`), []);
  const alEnviar = useCallback(
    async (datos: { token: string }) => {
      if (idPlan === "gratis") return;
      setError(null);
      setProcesando(true);
      try {
        const { activa } = await suscribirConTarjeta(idPlan, periodo, datos.token);
        alPagar.current(activa);
      } catch (e) {
        setProcesando(false);
        setError(`No se pudo completar el pago: ${(e as Error).message}. Revisa los datos e inténtalo de nuevo.`);
        setListo(false);
        setIntento((n) => n + 1);
      }
    },
    [idPlan, periodo]
  );

  return (
    <div ref={caja} className="mt-4 rounded-lg p-3" style={{ border: "1px solid var(--marca)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Plan {plan.nombre} {periodo}: {moneda.format(monto)} {periodo === "anual" ? "al año" : "al mes"}
        </p>
        <button type="button" onClick={onCancelar} disabled={procesando} className="text-sm underline" style={{ color: "var(--text-secondary)" }}>
          Elegir otro plan
        </button>
      </div>
      {!listo && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          Cargando el formulario seguro de Mercado Pago…
        </p>
      )}
      {procesando && (
        <p
          role="status"
          className="mt-2 rounded-md px-3 py-2 text-sm font-medium"
          style={{ background: "var(--page-plane)", border: "1px solid var(--marca)", color: "var(--text-primary)" }}
        >
          Procesando tu pago con Mercado Pago… No cierres ni recargues la página.
        </p>
      )}
      <div className="mt-2">
        <CardPayment
          key={intento}
          locale="es-MX"
          initialization={inicializacion}
          customization={personalizacion}
          onReady={alEstarListo}
          onError={alFallar}
          onSubmit={alEnviar}
        />
      </div>
      {error && (
        <p className="mt-2 text-sm" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}
      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Los datos de tu tarjeta van directo a Mercado Pago; Ordena tu Lana no los ve ni los guarda. El cobro se repite
        cada {periodo === "anual" ? "año" : "mes"} hasta que canceles aquí.
      </p>
    </div>
  );
}
