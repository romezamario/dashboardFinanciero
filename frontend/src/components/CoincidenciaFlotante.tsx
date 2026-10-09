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
  onCerrar,
}: {
  mov: MovimientoDia;
  x: number;
  y: number;
  coincidencia: Coincidencia | undefined;
  correo: EstadoCorreo;
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
          <DetalleAviso coincidencia={coincidencia} />
        ) : (
          <SinCoincidencia mov={mov} correo={correo} />
        )}
      </div>
    </TarjetaFlotante>
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
