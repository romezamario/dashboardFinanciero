import { useState } from "react";
import type { Coincidencia } from "../lib/conciliarCorreo";
import { nombreTarjeta } from "../lib/gastosCorreo";
import type { MovimientoDia } from "../lib/gastosEstadoCuenta";
import { formatoMoneda } from "../lib/gastosUI";
import { TarjetaFlotante } from "./TarjetaFlotante";

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

/**
 * Tarjetita flotante (`TarjetaFlotante`, del estilo de los tooltips de las
 * gráficas) con la posible coincidencia en el correo de un movimiento del
 * estado de cuenta. Se abre junto al clic (`x`, `y`).
 */
export function CoincidenciaFlotante({
  mov,
  x,
  y,
  coincidencia,
  correo,
  onHeredar,
  onCerrar,
}: {
  mov: MovimientoDia;
  x: number;
  y: number;
  coincidencia: Coincidencia | undefined;
  correo: EstadoCorreo;
  /** Asigna al movimiento el evento del aviso (guarda en Supabase). */
  onHeredar: (evento: string) => Promise<void>;
  onCerrar: () => void;
}) {
  return (
    <TarjetaFlotante x={x} y={y} etiqueta="Posible coincidencia en el correo" onCerrar={onCerrar}>
      <p className="pr-5 font-semibold">Posible coincidencia en el correo</p>

      <p className="mt-1 truncate" style={{ color: "var(--text-secondary)" }} title={mov.descripcion}>
        Estado de cuenta: {mov.descripcion} · {formatoMoneda.format(mov.centavos / 100)} ·{" "}
        {fechaLarga(mov.fecha)}
      </p>

      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--border)" }}>
        {coincidencia ? (
          <DetalleAviso mov={mov} coincidencia={coincidencia} onHeredar={onHeredar} />
        ) : (
          <SinCoincidencia mov={mov} correo={correo} />
        )}
      </div>
    </TarjetaFlotante>
  );
}

function DetalleAviso({
  mov,
  coincidencia,
  onHeredar,
}: {
  mov: MovimientoDia;
  coincidencia: Coincidencia;
  onHeredar: (evento: string) => Promise<void>;
}) {
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
        {gasto.evento && <Dato etiqueta="Evento" valor={gasto.evento} fuerte />}
      </dl>
      {gasto.evento && <HerenciaEvento mov={mov} evento={gasto.evento} onHeredar={onHeredar} />}
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

/** El aviso tiene evento: si el cargo no tiene ninguno se ofrece heredarlo (nunca se pisa uno ya asignado). */
function HerenciaEvento({
  mov,
  evento,
  onHeredar,
}: {
  mov: MovimientoDia;
  evento: string;
  onHeredar: (evento: string) => Promise<void>;
}) {
  const [estado, setEstado] = useState<"reposo" | "trabajando" | "hecho">("reposo");
  const [error, setError] = useState<string | null>(null);

  if (estado === "hecho") {
    return (
      <p className="mt-2 font-medium" style={{ color: "var(--status-good)" }}>
        ✓ Se asignó «{evento}» a este movimiento.
      </p>
    );
  }
  if (mov.evento === evento) {
    return (
      <p className="mt-2" style={{ color: "var(--text-secondary)" }}>
        ✓ Este movimiento ya tiene ese evento.
      </p>
    );
  }
  if (mov.evento) {
    return (
      <p className="mt-2" style={{ color: "var(--text-muted)" }}>
        Este movimiento ya tiene el evento «{mov.evento}»: no se cambia.
      </p>
    );
  }
  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={estado === "trabajando"}
        onClick={async () => {
          setEstado("trabajando");
          setError(null);
          try {
            await onHeredar(evento);
            setEstado("hecho");
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo guardar.");
            setEstado("reposo");
          }
        }}
        className="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        style={{ background: "var(--series-1)" }}
      >
        {estado === "trabajando" ? "Guardando…" : `Asignar «${evento}» a este movimiento`}
      </button>
      {error && (
        <p className="mt-1" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
