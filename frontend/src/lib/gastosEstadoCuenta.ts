import type { Sumas } from "./gastosCorreo";
import { categoriaDe, cuentaDe, eventoDe } from "./queries";
import { esTarjetaCredito } from "./tarjetas";
import type { Transaccion } from "./types";

// Vista "Por estado de cuenta" de "Gastos recientes": los mismos días/tablas que
// la vista por correo, pero armados con `transacciones` (lo que traen los PDF).
// Diferencias con los avisos de correo:
//  - no hay hora ni ciudad; la "tarjeta" que distingue columnas es la CUENTA
//    (`cuentas.alias`: "TDC Beyond", "Cuenta Priority"...);
//  - hay abonos, pagos de tarjeta y movimientos de la cuenta de cheques. Solo
//    SUMAN al día los CARGOS de tarjetas de crédito cuya categoría no esté
//    oculta; el resto (abonos, cuenta de cheques) se lista
//    aparte ("No suman al total") para poder verlo sin inflar el gasto.

/** Un movimiento de un día. `centavos` siempre positivo (el signo lo da `tipo`). */
export interface MovimientoDia {
  id: string;
  fecha: string;
  descripcion: string;
  categoria: string;
  /** "" cuando la regla no puso comercio. */
  comercio: string;
  cuenta: string;
  /** Titular / Adicional / Digital (o la terminación en Invex V2). */
  tarjeta: string | null;
  evento: string | null;
  centavos: number;
  tipo: "cargo" | "abono";
  /** La cuenta no es una TDC (p. ej. la de cheques "Priority"). */
  esDebito: boolean;
}

export type MotivoSinSumar =
  | "Es un abono"
  | "Cuenta de cheques"
  | "Categoría oculta"
  | "Evento oculto";

export interface MovimientoSinSumar {
  mov: MovimientoDia;
  motivo: MotivoSinSumar;
}

export type FilaDetalleEstado =
  | { tipo: "gasto"; gasto: MovimientoDia }
  | { tipo: "comercio"; comercio: string; sumas: Sumas }
  | { tipo: "categoria"; categoria: string; sumas: Sumas };

export interface DiaEstadoCuenta {
  fecha: string;
  /** Cargos que suman al gasto del día. */
  gastos: MovimientoDia[];
  /** Todo lo demás del día (abonos y cargos de categorías ocultas). */
  sinSumar: MovimientoSinSumar[];
  /** Cuentas de los movimientos que suman: las columnas de las tablas. */
  cuentas: string[];
  /** Alias de las cuentas que no son TDC con movimientos ese día (sumen o no). */
  cuentasDebito: string[];
  /** Hay abonos de categorías no ocultas (ingresos, devoluciones...). */
  hayAbonos: boolean;
  total: Sumas;
  resumen: { categoria: string; sumas: Sumas }[];
  detalle: FilaDetalleEstado[];
}

const porTexto = (a: string, b: string) => a.localeCompare(b, "es");

function sumar(movs: MovimientoDia[], cuentas: string[]): Sumas {
  const porTarjeta: Record<string, number> = {};
  for (const c of cuentas) porTarjeta[c] = 0;
  let total = 0;
  for (const m of movs) {
    porTarjeta[m.cuenta] = (porTarjeta[m.cuenta] ?? 0) + m.centavos;
    total += m.centavos;
  }
  return { porTarjeta, total };
}

export const sumarUnoEstado = (m: MovimientoDia, cuentas: string[]): Sumas => sumar([m], cuentas);

/** Pasa una transacción al formato del día. Los cargos de $0 (líneas de eco de
 * Invex V2, ver CLAUDE.md) no son movimientos: devuelve null. */
function aMovimiento(t: Transaccion): MovimientoDia | null {
  const centavos = Math.round(t.monto * 100);
  if (centavos <= 0) return null;
  return {
    id: t.id,
    fecha: t.fecha,
    descripcion: t.descripcion,
    categoria: categoriaDe(t),
    comercio: t.comercio ?? "",
    cuenta: cuentaDe(t),
    tarjeta: t.tarjeta,
    evento: eventoDe(t),
    centavos,
    tipo: t.tipo,
    esDebito: !esTarjetaCredito(t),
  };
}

/**
 * Agrupa las transacciones por día (del más reciente al más antiguo).
 * Solo suman los CARGOS de cuentas de crédito cuya categoría no esté en
 * `categoriasOcultas` y que no pertenezcan a un evento de `eventosOcultos`.
 * Los abonos nunca suman (pagos recibidos, ingresos o
 * devoluciones: restarlos cancelaría el gasto que pagaron) y la cuenta de
 * cheques tampoco; todo eso queda en `sinSumar`, visible en el detalle.
 */
export function agruparEstadosPorDia(
  transacciones: Transaccion[],
  categoriasOcultas: Set<string>,
  eventosOcultos: Set<string> = new Set()
): DiaEstadoCuenta[] {
  const porFecha = new Map<string, MovimientoDia[]>();
  for (const t of transacciones) {
    const m = aMovimiento(t);
    if (!m) continue;
    const lista = porFecha.get(m.fecha);
    if (lista) lista.push(m);
    else porFecha.set(m.fecha, [m]);
  }
  return Array.from(porFecha.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([fecha, movs]) => armarDia(fecha, movs, categoriasOcultas, eventosOcultos));
}

function armarDia(
  fecha: string,
  movs: MovimientoDia[],
  categoriasOcultas: Set<string>,
  eventosOcultos: Set<string>
): DiaEstadoCuenta {
  const gastos: MovimientoDia[] = [];
  const sinSumar: MovimientoSinSumar[] = [];
  let hayAbonos = false;
  for (const mov of movs) {
    if (mov.tipo === "abono") {
      sinSumar.push({ mov, motivo: "Es un abono" });
      // Pagar la tarjeta (o un traspaso entre tus cuentas) no es un ingreso.
      if (!categoriasOcultas.has(mov.categoria) && !(mov.evento && eventosOcultos.has(mov.evento))) {
        hayAbonos = true;
      }
    } else if (mov.esDebito) {
      // La cuenta de cheques (Priority) se ve en el día pero no suma: sus
      // compras ya cuentan por las tarjetas, y sus pagos/traspasos no son gasto.
      sinSumar.push({ mov, motivo: "Cuenta de cheques" });
    } else if (categoriasOcultas.has(mov.categoria)) {
      sinSumar.push({ mov, motivo: "Categoría oculta" });
    } else if (mov.evento && eventosOcultos.has(mov.evento)) {
      sinSumar.push({ mov, motivo: "Evento oculto" });
    } else {
      gastos.push(mov);
    }
  }

  const cuentas = Array.from(new Set(gastos.map((g) => g.cuenta))).sort(porTexto);
  const cuentasDebito = Array.from(new Set(movs.filter((m) => m.esDebito).map((m) => m.cuenta))).sort(
    porTexto
  );

  // Categorías de más a menos gasto del día (alfabético si empatan): es lo
  // que se quiere ver primero. (En la vista por correo el orden es fijo.)
  const sumaPorCategoria = new Map<string, number>();
  for (const g of gastos) {
    sumaPorCategoria.set(g.categoria, (sumaPorCategoria.get(g.categoria) ?? 0) + g.centavos);
  }
  const categorias = Array.from(sumaPorCategoria.keys()).sort(
    (a, b) => (sumaPorCategoria.get(b) ?? 0) - (sumaPorCategoria.get(a) ?? 0) || porTexto(a, b)
  );

  const resumen = categorias.map((categoria) => ({
    categoria,
    sumas: sumar(
      gastos.filter((g) => g.categoria === categoria),
      cuentas
    ),
  }));

  const detalle: FilaDetalleEstado[] = [];
  for (const categoria of categorias) {
    const enCategoria = gastos.filter((g) => g.categoria === categoria);
    const comercios = Array.from(new Set(enCategoria.map((g) => g.comercio)))
      .filter((c) => c !== "")
      .sort(porTexto);
    for (const comercio of comercios) {
      const filas = enCategoria
        .filter((g) => g.comercio === comercio)
        .sort((a, b) => porTexto(a.descripcion, b.descripcion));
      for (const gasto of filas) detalle.push({ tipo: "gasto", gasto });
      if (filas.length > 1) {
        detalle.push({ tipo: "comercio", comercio, sumas: sumar(filas, cuentas) });
      }
    }
    // Sin comercio: la regla no lo puso; van al final de la categoría, sin
    // subtotal (no hay un "comercio" que agrupe).
    enCategoria
      .filter((g) => g.comercio === "")
      .sort((a, b) => porTexto(a.descripcion, b.descripcion))
      .forEach((gasto) => detalle.push({ tipo: "gasto", gasto }));
    detalle.push({ tipo: "categoria", categoria, sumas: sumar(enCategoria, cuentas) });
  }

  sinSumar.sort(
    (a, b) => porTexto(a.mov.categoria, b.mov.categoria) || porTexto(a.mov.descripcion, b.mov.descripcion)
  );

  return {
    fecha,
    gastos,
    sinSumar,
    cuentas,
    cuentasDebito,
    hayAbonos,
    total: sumar(gastos, cuentas),
    resumen,
    detalle,
  };
}

/** Hasta qué fecha llega lo cargado de cada cuenta: los estados de cuenta
 * llegan con semanas de atraso, así que un día vacío después de esa fecha no
 * significa "no gastaste". */
export interface UltimaFechaCuenta {
  cuenta: string;
  fecha: string;
  esDebito: boolean;
}

export function ultimaFechaPorCuenta(transacciones: Transaccion[]): UltimaFechaCuenta[] {
  const porCuenta = new Map<string, UltimaFechaCuenta>();
  for (const t of transacciones) {
    const cuenta = cuentaDe(t);
    const actual = porCuenta.get(cuenta);
    if (!actual || t.fecha > actual.fecha) {
      porCuenta.set(cuenta, { cuenta, fecha: t.fecha, esDebito: !esTarjetaCredito(t) });
    }
  }
  return Array.from(porCuenta.values()).sort((a, b) => porTexto(a.cuenta, b.cuenta));
}

/** Días entre dos fechas ISO (a - b), en UTC para que la zona horaria no mueva el día. */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Nombre corto para la insignia del calendario: "Cuenta Priority" -> "Priority". */
export const nombreCorto = (cuenta: string) => cuenta.replace(/^cuenta\s+/i, "");
