import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SaldoAgente } from "../../functions/api/agente-saldo";
import type { CuentaAlpaca, OrdenAgente, PosicionAgente } from "../../functions/api/agente-saldo";
import {
  estadoOrdenAlpaca,
  fraccionEnEfectivo,
  nombreActivo,
  nombreSimboloAlpaca,
  obtenerSaldoAgente,
  ordenesRecientesPrimero,
  resumirAlpaca,
  resumirGanancias,
  resumirSaldo,
} from "../lib/agente";
import { estiloTooltip } from "../lib/estilos";
import {
  cantidad,
  compacto,
  dolares,
  entero,
  dolaresConSigno,
  fechaCorta,
  fechaHora,
  moneda,
  monedaConCentavos,
  monedaConSigno,
  porcentaje1,
  porcentajeConSigno1,
  porcentajePequeno,
  precioUsd,
} from "../lib/formato";
import { Tabla } from "./IndicadoresUI";

const COLOR_SALDO = "var(--series-1)";

export function AgenteTradingTab() {
  const [saldo, setSaldo] = useState<SaldoAgente | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    obtenerSaldoAgente()
      .then((s) => vigente && setSaldo(s))
      .catch((e: unknown) => vigente && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      vigente = false;
    };
  }, []);

  const resumen = useMemo(() => (saldo ? resumirSaldo(saldo) : null), [saldo]);
  const ganancias = useMemo(() => (saldo ? resumirGanancias(saldo) : null), [saldo]);

  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--status-critical)" }}>
        No se pudo leer el saldo del agente: {error}
      </p>
    );
  }
  if (!saldo) {
    return <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Cargando…</p>;
  }
  if (!resumen) {
    return <p className="text-sm" style={{ color: "var(--text-secondary)" }}>El agente todavía no tiene saldo.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {saldo.alpaca && <SeccionAlpaca cuenta={saldo.alpaca} />}
      <section className="flex flex-col gap-4">
        <Encabezado
          titulo={`Simulación del agente (${saldo.currency})`}
          detalle={`Backtest diario con dinero simulado: el agente aplica sus reglas a los precios de cada día
            desde el ${fechaCorta(resumen.desde)} (último dato: ${fechaCorta(resumen.hasta)}). No es la cuenta de Alpaca.`}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Dato titulo="Saldo simulado" valor={monedaConCentavos.format(resumen.saldoActual)} />
          <Dato
            titulo={`Desde ${moneda.format(resumen.saldoInicial)} iniciales`}
            valor={porcentajeConSigno1.format(resumen.cambio)}
          />
          <Dato titulo="Peor caída desde un máximo" valor={porcentajeConSigno1.format(resumen.peorCaida)} />
          <Dato
            titulo={`Avance a la meta de ${compacto.format(saldo.goal)}`}
            valor={porcentajePequeno.format(resumen.avanceMeta)}
          />
        </div>
        <GraficaSaldo
          titulo={`Saldo de la simulación (${saldo.currency})`}
          puntos={saldo.series.map((p) => ({ date: p.date, valor: p.balance }))}
          inicial={resumen.saldoInicial}
          formato={(v) => monedaConCentavos.format(v)}
        />
        {ganancias && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Dato titulo="Ganancia realizada (ventas)" valor={<Monto valor={ganancias.realizada} />} />
            <Dato titulo="Ganancia no realizada (posiciones abiertas)" valor={<Monto valor={ganancias.noRealizada} />} />
            <Dato
              titulo="Tipo de cambio sobre el efectivo (se guarda en dólares)"
              valor={<Monto valor={ganancias.tipoDeCambio} />}
            />
          </div>
        )}
        {saldo.positions && <Posiciones posiciones={saldo.positions} hasta={resumen.hasta} />}
        {saldo.trades && <Ordenes ordenes={saldo.trades} />}
      </section>
    </div>
  );
}

function Encabezado({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="border-b pb-2" style={{ borderColor: "var(--border)" }}>
      <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{titulo}</h3>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{detalle}</p>
    </div>
  );
}

/** Una sola serie (el saldo), así que no hay leyenda: el título la nombra. Línea en --series-1
 * (paleta ya validada) y una referencia punteada en el saldo inicial. */
function GraficaSaldo({ titulo, puntos, inicial, formato, formatoEje = (v) => compacto.format(v) }: {
  titulo: string;
  puntos: { date: string; valor: number }[];
  inicial: number;
  formato: (v: number) => string;
  /** Las etiquetas del eje; "100 k" no distingue movimientos de cientos de dólares. */
  formatoEje?: (v: number) => string;
}) {
  return (
    <div className="rounded-lg p-4 tarjeta">
      <h4 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{titulo}</h4>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={puntos}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
              tickFormatter={(f: string) => fechaCorta(f)}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              domain={["auto", "auto"]}
              tickFormatter={formatoEje}
              width={64}
            />
            <ReferenceLine
              y={inicial}
              stroke="var(--baseline)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{ value: "Inicial", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 11 }}
            />
            <Tooltip
              contentStyle={estiloTooltip}
              itemStyle={{ color: "var(--text-primary)" }}
              labelFormatter={(f) => fechaCorta(String(f))}
              formatter={(v) => [formato(Number(v)), "Saldo"]}
            />
            <Line
              type="monotone"
              dataKey="valor"
              stroke={COLOR_SALDO}
              strokeWidth={2}
              dot={puntos.length < 15}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Posiciones({ posiciones, hasta }: { posiciones: PosicionAgente[]; hasta: string }) {
  const efectivo = fraccionEnEfectivo(posiciones);
  return (
    <Tabla
      titulo={`Posiciones abiertas al ${fechaCorta(hasta)} · ${porcentaje1.format(efectivo)} en efectivo`}
      vacio="El agente no tiene posiciones abiertas: todo está en efectivo."
      encabezados={["Activo", "% de la cuenta", "Valor", "Costo", "Ganancia no realizada", "Desde", "Precio de entrada", "Precio actual"]}
      filas={posiciones.map((p) => [
        nombreActivo(p.asset),
        porcentaje1.format(p.weight),
        monedaConCentavos.format(p.value_mxn),
        p.cost_basis_mxn != null ? monedaConCentavos.format(p.cost_basis_mxn) : "—",
        p.unrealized_pnl_mxn != null ? <Monto key="g" valor={p.unrealized_pnl_mxn} fraccion={p.unrealized_pnl_pct} /> : "—",
        p.entry_date ? fechaCorta(p.entry_date) : "—",
        p.entry_price_usd != null ? precioUsd(p.entry_price_usd) : "—",
        precioUsd(p.price_usd),
      ])}
    />
  );
}

function Ordenes({ ordenes }: { ordenes: OrdenAgente[] }) {
  const ordenadas = useMemo(() => ordenesRecientesPrimero(ordenes), [ordenes]);
  const comisiones = ordenes.reduce((suma, o) => suma + o.cost_mxn, 0);
  return (
    <Tabla
      titulo={`Órdenes ejecutadas (${ordenes.length}) · ${monedaConCentavos.format(comisiones)} en comisiones`}
      vacio="El agente todavía no ha ejecutado órdenes."
      encabezados={["Fecha", "Activo", "Operación", "Monto", "Ganancia/pérdida", "Precio", "% de la cuenta", "Comisión"]}
      filas={ordenadas.map((o) => [
        fechaCorta(o.date),
        nombreActivo(o.asset),
        o.side === "buy" ? "Compra" : "Venta",
        monedaConCentavos.format(o.amount_mxn),
        o.pnl_mxn !== undefined ? <Monto key="g" valor={o.pnl_mxn} fraccion={o.pnl_pct} /> : "—",
        precioUsd(o.price_usd),
        `${porcentaje1.format(o.weight_before)} → ${porcentaje1.format(o.weight_after)}`,
        monedaConCentavos.format(o.cost_mxn),
      ])}
    />
  );
}

/** La cuenta de prueba (paper) en Alpaca: un broker de verdad recibe las mismas decisiones que la
 * simulación, con dinero simulado. Está en dólares y no cuadra exacto con la simulación en pesos. */
function SeccionAlpaca({ cuenta }: { cuenta: CuentaAlpaca }) {
  const r = useMemo(() => resumirAlpaca(cuenta), [cuenta]);
  const historial = useMemo(
    () => (cuenta.historial ?? []).map((p) => ({ date: p.date, valor: p.equity })),
    [cuenta.historial]
  );
  return (
    <section className="flex flex-col gap-4">
      <Encabezado
        titulo={`Cuenta de prueba en Alpaca (${cuenta.moneda})`}
        detalle={`Broker real con dinero simulado: recibe cada noche las órdenes del agente. Actualizado el
          ${fechaHora(cuenta.actualizado)}; las órdenes de ETFs esperan a que abra la bolsa.`}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Dato titulo="Valor de la cuenta" valor={dolares.format(r.valor)} />
        <Dato titulo="Efectivo" valor={dolares.format(r.efectivo)} />
        <Dato
          titulo="Cambio vs. el cierre anterior"
          valor={r.cambioDia !== null ? <MontoUsd valor={r.cambioDia} fraccion={r.cambioDiaPct} /> : "—"}
        />
        <Dato titulo="Ganancia no realizada" valor={<MontoUsd valor={r.noRealizada} />} />
      </div>
      {historial.length > 0 && (
        <GraficaSaldo
          titulo={`Valor de la cuenta en Alpaca (${cuenta.moneda})`}
          puntos={historial}
          inicial={historial[0].valor}
          formato={(v) => dolares.format(v)}
          formatoEje={(v) => entero.format(v)}
        />
      )}
      <Tabla
        titulo={`Posiciones en Alpaca (${cuenta.posiciones.length})`}
        vacio="Todavía no hay posiciones: las órdenes siguen en espera."
        encabezados={["Activo", "Cantidad", "Valor", "Costo", "Ganancia no realizada", "Precio de entrada", "Precio actual"]}
        filas={cuenta.posiciones.map((p) => [
          nombreSimboloAlpaca(p.symbol),
          p.qty != null ? cantidad.format(p.qty) : "—",
          p.market_value != null ? dolares.format(p.market_value) : "—",
          p.cost_basis != null ? dolares.format(p.cost_basis) : "—",
          p.unrealized_pl != null ? <MontoUsd key="g" valor={p.unrealized_pl} fraccion={p.unrealized_plpc} /> : "—",
          p.avg_entry_price != null ? precioUsd(p.avg_entry_price) : "—",
          p.current_price != null ? precioUsd(p.current_price) : "—",
        ])}
      />
      <Tabla
        titulo={`Órdenes en Alpaca (últimas ${cuenta.ordenes.length})`}
        vacio="Todavía no se ha mandado ninguna orden."
        encabezados={["Enviada", "Activo", "Operación", "Monto pedido", "Estado", "Cantidad ejecutada", "Precio de ejecución"]}
        filas={cuenta.ordenes.map((o) => [
          o.submitted_at ? fechaHora(o.submitted_at) : "—",
          nombreSimboloAlpaca(o.symbol),
          o.side === "buy" ? "Compra" : "Venta",
          o.notional != null ? dolares.format(o.notional) : o.qty != null ? `${cantidad.format(o.qty)} u.` : "Todo",
          estadoOrdenAlpaca(o.status),
          o.filled_qty ? cantidad.format(o.filled_qty) : "—",
          o.filled_avg_price != null ? precioUsd(o.filled_avg_price) : "—",
        ])}
      />
    </section>
  );
}

function MontoUsd({ valor, fraccion }: { valor: number; fraccion?: number | null }) {
  const color = valor > 0 ? "var(--status-good)" : valor < 0 ? "var(--status-critical)" : "var(--text-secondary)";
  return (
    <span style={{ color, fontVariantNumeric: "tabular-nums" }}>
      {dolaresConSigno.format(valor)}
      {fraccion != null && ` (${porcentajeConSigno1.format(fraccion)})`}
    </span>
  );
}

/** Ganancia/pérdida con signo escrito (no solo color): verde si gana, rojo si pierde. */
function Monto({ valor, fraccion }: { valor: number; fraccion?: number | null }) {
  const color = valor > 0 ? "var(--status-good)" : valor < 0 ? "var(--status-critical)" : "var(--text-secondary)";
  return (
    <span style={{ color, fontVariantNumeric: "tabular-nums" }}>
      {monedaConSigno.format(valor)}
      {fraccion != null && ` (${porcentajeConSigno1.format(fraccion)})`}
    </span>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3 tarjeta">
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{titulo}</div>
      <div className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{valor}</div>
    </div>
  );
}
