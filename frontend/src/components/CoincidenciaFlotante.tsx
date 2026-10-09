import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Coincidencia } from "../lib/conciliarCorreo";
import { nombreTarjeta } from "../lib/gastosCorreo";
import type { MovimientoDia } from "../lib/gastosEstadoCuenta";
import { formatoMoneda } from "../lib/gastosUI";

/** Estado de la carga de los avisos de correo (con lo que se empareja). */
export type EstadoCorreo =
  | { tipo: "cargando" }
  | { tipo: "error" }
  | { tipo: "listo"; primeraFecha: string | null };

const formatoFecha = new Intl.DateTimeFormat("es-MX", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const fechaLarga = (fecha: string) => formatoFecha.format(new Date(`${fecha}T12:00:00Z`));

const MARGEN = 8;

/**
 * Tarjetita flotante, del estilo de los tooltips de las gráficas, con la
 * posible coincidencia en el correo de un movimiento del estado de cuenta. Se
 * abre junto al clic (`x`, `y`: coordenadas de la ventana) y se cierra con
 * Escape, con un clic fuera de ella, con la ×, o al hacer scroll/cambiar el
 * tamaño de la ventana (ya no estaría junto a su fila).
 */
export function CoincidenciaFlotante({
  mov,
  x,
  y,
  coincidencia,
  correo,
  onCerrar,
}: {
  mov: MovimientoDia;
  x: number;
  y: number;
  coincidencia: Coincidencia | undefined;
  correo: EstadoCorreo;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [posicion, setPosicion] = useState({ left: x + 12, top: y + 12 });

  // Dentro de la ventana: si no cabe a la derecha o abajo, se corre hacia
  // adentro / se abre hacia arriba del clic.
  useLayoutEffect(() => {
    const caja = ref.current?.getBoundingClientRect();
    if (!caja) return;
    let left = x + 12;
    let top = y + 12;
    if (left + caja.width > window.innerWidth - MARGEN) {
      left = Math.max(MARGEN, window.innerWidth - caja.width - MARGEN);
    }
    if (top + caja.height > window.innerHeight - MARGEN) {
      top = Math.max(MARGEN, y - caja.height - 12);
    }
    setPosicion({ left, top });
  }, [x, y, mov.id, coincidencia, correo]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    const alPulsarFuera = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    document.addEventListener("mousedown", alPulsarFuera);
    window.addEventListener("scroll", onCerrar, true);
    window.addEventListener("resize", onCerrar);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      document.removeEventListener("mousedown", alPulsarFuera);
      window.removeEventListener("scroll", onCerrar, true);
      window.removeEventListener("resize", onCerrar);
    };
  }, [onCerrar]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Posible coincidencia en el correo"
      className="fixed z-50 w-80 max-w-[calc(100vw-16px)] rounded-lg p-3 text-xs"
      style={{
        left: posicion.left,
        top: posicion.top,
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">Posible coincidencia en el correo</p>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="-mt-1 px-1 text-base leading-none"
          style={{ color: "var(--text-muted)" }}
        >
          ×
        </button>
      </div>

      <p className="mt-1 truncate" style={{ color: "var(--text-secondary)" }} title={mov.descripcion}>
        Estado de cuenta: {mov.descripcion} · {formatoMoneda.format(mov.centavos / 100)} ·{" "}
        {fechaLarga(mov.fecha)}
      </p>

      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--border)" }}>
        {coincidencia ? (
          <DetalleAviso coincidencia={coincidencia} />
        ) : (
          <SinCoincidencia mov={mov} correo={correo} />
        )}
      </div>
    </div>
  );
}

function DetalleAviso({ coincidencia }: { coincidencia: Coincidencia }) {
  const { gasto, diasDeDiferencia, otrosCandidatos } = coincidencia;
  const lugar = gasto.ciudad ?? gasto.ciudad_cod;
  return (
    <>
      <p className="font-medium" style={{ color: "var(--status-good)" }}>
        ✓ {diasDeDiferencia === 0 ? "Mismo monto y mismo día" : "Mismo monto, a un día de diferencia"}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <Dato etiqueta="Aviso" valor={`${fechaLarga(gasto.fecha)}, ${gasto.hora} (CDMX)`} />
        <Dato etiqueta="Comercio" valor={gasto.comercio} fuerte />
        {gasto.establecimiento && <Dato etiqueta="Establecimiento" valor={gasto.establecimiento} />}
        {lugar && <Dato etiqueta="Ciudad" valor={lugar} />}
        <Dato etiqueta="Tarjeta" valor={nombreTarjeta(gasto.tarjeta)} />
        <Dato etiqueta="Categoría" valor={gasto.categoria} />
        <Dato etiqueta="Monto" valor={formatoMoneda.format(gasto.monto)} fuerte />
      </dl>
      {otrosCandidatos > 0 && (
        <p className="mt-2" style={{ color: "var(--text-muted)" }}>
          Hay {otrosCandidatos} {otrosCandidatos === 1 ? "aviso más" : "avisos más"} con el mismo monto en
          esos días: es una pista, no una confirmación.
        </p>
      )}
    </>
  );
}

function Dato({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <>
      <dt style={{ color: "var(--text-muted)" }}>{etiqueta}</dt>
      <dd className={`min-w-0 break-words ${fuerte ? "font-semibold" : ""}`}>{valor}</dd>
    </>
  );
}

function SinCoincidencia({ mov, correo }: { mov: MovimientoDia; correo: EstadoCorreo }) {
  let texto: string;
  if (mov.tipo === "abono" || mov.esDebito) {
    texto =
      "Los avisos de correo son de compras con tarjeta de crédito: este movimiento no tiene aviso con qué emparejarse.";
  } else if (correo.tipo === "cargando") {
    texto = "Cargando los avisos de correo…";
  } else if (correo.tipo === "error") {
    texto = "No se pudieron cargar los avisos de correo, así que no hay con qué emparejar.";
  } else if (correo.primeraFecha === null) {
    texto = "Todavía no hay avisos de correo cargados.";
  } else if (mov.fecha < correo.primeraFecha) {
    texto = `Sin coincidencia: los avisos de correo cargados empiezan el ${fechaLarga(correo.primeraFecha)}, después de este cargo.`;
  } else {
    texto = `Sin coincidencia: no hay un aviso por ${formatoMoneda.format(mov.centavos / 100)} el ${fechaLarga(mov.fecha)} ni un día antes o después.`;
  }
  return <p style={{ color: "var(--text-secondary)" }}>{texto}</p>;
}
