import { categoriaDe, cuentaDe } from "./queries";
import type { Transaccion } from "./types";

// Cálculos de la pestaña "Indicadores". Igual que los promedios del Resumen,
// todo se mide sobre meses de calendario COMPLETOS anteriores al mes en
// curso -- los estados de cuenta llegan a mes vencido, así que el mes en
// curso siempre está incompleto y distorsionaría cualquier indicador.

/** Umbral (MXN) bajo el cual un cargo cuenta como "gasto hormiga". */
export const UMBRAL_GASTO_HORMIGA = 200;

/** Ventana (en meses completos) para detectar gastos recurrentes, y en
 * cuántos de esos meses distintos debe aparecer un comercio para contar. */
export const VENTANA_RECURRENTES = 6;
export const MESES_MINIMOS_RECURRENTE = 3;

/** Categorías que por defecto se excluyen de los indicadores: movimientos
 * entre cuentas propias (p. ej. pagar la TDC desde la cuenta de cheques)
 * aparecen como gasto en una cuenta e ingreso en la otra, e inflarían ambos
 * lados sin ser gasto ni ingreso real. El usuario puede cambiar la
 * selección en la pestaña. */
const PATRON_EXCLUIDA_POR_DEFECTO = /pago\s+tdc|entre\s+cuentas|traspaso/i;

export function categoriasExcluidasPorDefecto(categorias: string[]): Set<string> {
  return new Set(categorias.filter((c) => PATRON_EXCLUIDA_POR_DEFECTO.test(c)));
}

function claveMes(anio: number, mes: number): string {
  // `mes` 0-indexado como Date.getMonth(); normaliza el acarreo de año sin
  // pasar por Date/toISOString (que convierte a UTC y puede correr el mes).
  const indice = anio * 12 + mes;
  const a = Math.floor(indice / 12);
  const m = indice - a * 12;
  return `${a}-${String(m + 1).padStart(2, "0")}`;
}

/** Los `cantidad` meses completos anteriores al mes en curso, del más
 * antiguo al más reciente (el último es el mes pasado). `desplazamiento`
 * recorre la ventana hacia atrás (p. ej. 3 = la ventana anterior de 3). */
export function mesesCompletos(cantidad: number, desplazamiento = 0, hoy = new Date()): string[] {
  const meses: string[] = [];
  for (let i = cantidad + desplazamiento; i > desplazamiento; i--) {
    meses.push(claveMes(hoy.getFullYear(), hoy.getMonth() - i));
  }
  return meses;
}

const mesDe = (t: Transaccion) => t.fecha.slice(0, 7);

/** (ingresos - gastos) / ingresos; null si no hubo ingresos (no hay base
 * contra la cual medir, a diferencia de 0%). */
export function tasaDeAhorro(ingresos: number, gastos: number): number | null {
  return ingresos > 0 ? (ingresos - gastos) / ingresos : null;
}

export interface ResumenMes {
  mes: string;
  ingresos: number;
  gastos: number;
  neto: number;
  tasaAhorro: number | null;
}

/** Un renglón por cada mes de `meses` (también los que no tienen
 * movimientos -- un mes sin datos es $0, no un hueco en la serie). */
export function resumenPorMes(transacciones: Transaccion[], meses: string[]): ResumenMes[] {
  const porMes = new Map(meses.map((m) => [m, { ingresos: 0, gastos: 0 }]));
  for (const t of transacciones) {
    const acumulado = porMes.get(mesDe(t));
    if (!acumulado) continue;
    if (t.tipo === "abono") acumulado.ingresos += t.monto;
    else acumulado.gastos += t.monto;
  }
  return meses.map((mes) => {
    const { ingresos, gastos } = porMes.get(mes)!;
    return { mes, ingresos, gastos, neto: ingresos - gastos, tasaAhorro: tasaDeAhorro(ingresos, gastos) };
  });
}

function sumar(resumen: ResumenMes[]): { ingresos: number; gastos: number } {
  return resumen.reduce(
    (a, r) => ({ ingresos: a.ingresos + r.ingresos, gastos: a.gastos + r.gastos }),
    { ingresos: 0, gastos: 0 }
  );
}

export interface GastoRecurrente {
  comercio: string;
  mesesPresente: number;
  montoMensual: number;
}

/**
 * Comercios con cargos en al menos `MESES_MINIMOS_RECURRENTE` meses
 * distintos de los últimos `VENTANA_RECURRENTES` y con actividad en alguno
 * de los 2 últimos meses (si dejó de cobrarse hace meses, ya no es un gasto
 * fijo vigente). `montoMensual` = total en la ventana / meses con cargo. Se
 * agrupa por `comercio` (no por descripción cruda, que trae referencias
 * distintas en cada cargo), así que solo detecta lo que las reglas de
 * categorización ya etiquetan con comercio.
 */
export function detectarGastosRecurrentes(
  transacciones: Transaccion[],
  hoy = new Date()
): GastoRecurrente[] {
  const ventana = new Set(mesesCompletos(VENTANA_RECURRENTES, 0, hoy));
  const recientes = new Set(mesesCompletos(2, 0, hoy));
  const porComercio = new Map<string, { meses: Set<string>; total: number }>();

  for (const t of transacciones) {
    if (t.tipo !== "cargo" || !t.comercio || !ventana.has(mesDe(t))) continue;
    const acumulado = porComercio.get(t.comercio) ?? { meses: new Set<string>(), total: 0 };
    acumulado.meses.add(mesDe(t));
    acumulado.total += t.monto;
    porComercio.set(t.comercio, acumulado);
  }

  return Array.from(porComercio.entries())
    .filter(
      ([, { meses }]) =>
        meses.size >= MESES_MINIMOS_RECURRENTE && Array.from(meses).some((m) => recientes.has(m))
    )
    .map(([comercio, { meses, total }]) => ({
      comercio,
      mesesPresente: meses.size,
      montoMensual: total / meses.size,
    }))
    .sort((a, b) => b.montoMensual - a.montoMensual);
}

export interface CategoriaEnAlza {
  categoria: string;
  ultimoMes: number;
  promedioAnterior: number;
  diferencia: number;
}

/** Categorías cuyo gasto del mes pasado supera su promedio mensual de los 3
 * meses anteriores, ordenadas por el aumento en pesos. */
export function categoriasEnAlza(transacciones: Transaccion[], hoy = new Date()): CategoriaEnAlza[] {
  const [ultimo] = mesesCompletos(1, 0, hoy);
  const anteriores = new Set(mesesCompletos(3, 1, hoy));
  const porCategoria = new Map<string, { ultimo: number; anteriores: number }>();

  for (const t of transacciones) {
    if (t.tipo !== "cargo") continue;
    const mes = mesDe(t);
    if (mes !== ultimo && !anteriores.has(mes)) continue;
    const categoria = categoriaDe(t);
    const acumulado = porCategoria.get(categoria) ?? { ultimo: 0, anteriores: 0 };
    if (mes === ultimo) acumulado.ultimo += t.monto;
    else acumulado.anteriores += t.monto;
    porCategoria.set(categoria, acumulado);
  }

  return Array.from(porCategoria.entries())
    .map(([categoria, a]) => {
      const promedioAnterior = a.anteriores / 3;
      return { categoria, ultimoMes: a.ultimo, promedioAnterior, diferencia: a.ultimo - promedioAnterior };
    })
    .filter((c) => c.diferencia > 0)
    .sort((a, b) => b.diferencia - a.diferencia);
}

/** Saldo más reciente de cada cuenta que reporta saldo (las TDC no traen
 * saldo por renglón, así que solo cuentan cuentas de débito/cheques). null
 * si ninguna cuenta tiene saldo. */
export function saldoDisponible(transacciones: Transaccion[]): number | null {
  const ultimoPorCuenta = new Map<string, { fecha: string; saldo: number }>();
  for (const t of transacciones) {
    if (t.saldo === null) continue;
    const cuenta = cuentaDe(t);
    const previo = ultimoPorCuenta.get(cuenta);
    // `>=`: las transacciones llegan ordenadas por fecha, así que dentro del
    // mismo día gana la última en el orden recibido.
    if (!previo || t.fecha >= previo.fecha) ultimoPorCuenta.set(cuenta, { fecha: t.fecha, saldo: t.saldo });
  }
  if (ultimoPorCuenta.size === 0) return null;
  return Array.from(ultimoPorCuenta.values()).reduce((s, c) => s + c.saldo, 0);
}

/** Cuántas categorías de ingreso/gasto se muestran con nombre propio en el
 * diagrama de flujo antes de plegar el resto en "Otros" -- mismo criterio
 * que el tope de 8 en GastoPorCategoriaChart, pero más chico del lado de
 * ingresos porque en la práctica hay muy pocas categorías de ingreso. */
export const TOPE_SANKEY_INGRESOS = 5;
export const TOPE_SANKEY_GASTOS = 8;

export interface RamaSankey {
  categoria: string;
  monto: number;
}

export interface FlujoSankeyDatos {
  ingresos: RamaSankey[];
  gastos: RamaSankey[];
  totalIngresos: number;
  totalGastos: number;
  /** ingresos - gastos; negativo = se gastó más de lo que entró. */
  ahorro: number;
  meses: string[];
}

function topeConOtros(porCategoria: Map<string, number>, tope: number): RamaSankey[] {
  const ordenado = Array.from(porCategoria.entries())
    .map(([categoria, monto]) => ({ categoria, monto }))
    .sort((a, b) => b.monto - a.monto);
  const visibles = ordenado.slice(0, tope);
  const otros = ordenado.slice(tope).reduce((s, c) => s + c.monto, 0);
  return otros > 0 ? [...visibles, { categoria: "Otros", monto: otros }] : visibles;
}

/**
 * Desglose para el diagrama de flujo (Sankey) de ingresos y gastos: de qué
 * categorías viene el ingreso, cuánto se ahorra vs. se gasta, y a qué
 * categorías va el gasto. Ventana de los últimos 3 meses completos -- igual
 * que la tasa de ahorro "hero" de la pestaña, para que ambos números
 * cuenten la misma historia reciente sin que un solo mes atípico domine.
 */
export function calcularFlujoSankey(transacciones: Transaccion[], hoy = new Date()): FlujoSankeyDatos {
  const meses = mesesCompletos(3, 0, hoy);
  const ventana = new Set(meses);
  const porCategoriaIngreso = new Map<string, number>();
  const porCategoriaGasto = new Map<string, number>();

  for (const t of transacciones) {
    if (!ventana.has(mesDe(t))) continue;
    const categoria = categoriaDe(t);
    if (t.tipo === "abono") {
      porCategoriaIngreso.set(categoria, (porCategoriaIngreso.get(categoria) ?? 0) + t.monto);
    } else {
      porCategoriaGasto.set(categoria, (porCategoriaGasto.get(categoria) ?? 0) + t.monto);
    }
  }

  const ingresos = topeConOtros(porCategoriaIngreso, TOPE_SANKEY_INGRESOS);
  const gastos = topeConOtros(porCategoriaGasto, TOPE_SANKEY_GASTOS);
  const totalIngresos = ingresos.reduce((s, c) => s + c.monto, 0);
  const totalGastos = gastos.reduce((s, c) => s + c.monto, 0);

  return { ingresos, gastos, totalIngresos, totalGastos, ahorro: totalIngresos - totalGastos, meses };
}

export interface Indicadores {
  /** Últimos 12 meses completos, para la gráfica de flujo neto. */
  meses: ResumenMes[];
  tasaAhorro3m: number | null;
  tasaAhorro3mAnterior: number | null;
  tasaAhorro12m: number | null;
  flujoNetoPromedio3m: number;
  gastoUltimoMes: number;
  gastoPromedio12m: number;
  mesUltimo: string;
  recurrentes: GastoRecurrente[];
  totalRecurrenteMensual: number;
  hormiga: { cantidad: number; total: number; proporcion: number | null };
  enAlza: CategoriaEnAlza[];
  /** Meses de gasto promedio (3m) que cubre el saldo disponible. */
  mesesDeCobertura: number | null;
  saldoDisponible: number | null;
}

/** `transacciones` ya debe venir sin las categorías excluidas. `saldo` se
 * calcula aparte (ver `saldoDisponible`) sobre el conjunto sin excluir: es
 * un hecho de la cuenta, no un agregado que dependa de qué categorías se
 * cuentan como gasto. */
export function calcularIndicadores(
  transacciones: Transaccion[],
  saldo: number | null,
  hoy = new Date()
): Indicadores {
  const meses = resumenPorMes(transacciones, mesesCompletos(12, 0, hoy));
  const ultimos3 = sumar(meses.slice(-3));
  const anteriores3 = sumar(resumenPorMes(transacciones, mesesCompletos(3, 3, hoy)));
  const total12 = sumar(meses);
  const ultimo = meses[meses.length - 1];

  const recurrentes = detectarGastosRecurrentes(transacciones, hoy);

  const hormigas = transacciones.filter(
    (t) => t.tipo === "cargo" && mesDe(t) === ultimo.mes && t.monto < UMBRAL_GASTO_HORMIGA
  );
  const totalHormiga = hormigas.reduce((s, t) => s + t.monto, 0);

  const gastoPromedio3m = ultimos3.gastos / 3;

  return {
    meses,
    tasaAhorro3m: tasaDeAhorro(ultimos3.ingresos, ultimos3.gastos),
    tasaAhorro3mAnterior: tasaDeAhorro(anteriores3.ingresos, anteriores3.gastos),
    tasaAhorro12m: tasaDeAhorro(total12.ingresos, total12.gastos),
    flujoNetoPromedio3m: (ultimos3.ingresos - ultimos3.gastos) / 3,
    gastoUltimoMes: ultimo.gastos,
    gastoPromedio12m: total12.gastos / 12,
    mesUltimo: ultimo.mes,
    recurrentes,
    totalRecurrenteMensual: recurrentes.reduce((s, r) => s + r.montoMensual, 0),
    hormiga: {
      cantidad: hormigas.length,
      total: totalHormiga,
      proporcion: ultimo.gastos > 0 ? totalHormiga / ultimo.gastos : null,
    },
    enAlza: categoriasEnAlza(transacciones, hoy),
    mesesDeCobertura: saldo !== null && gastoPromedio3m > 0 ? saldo / gastoPromedio3m : null,
    saldoDisponible: saldo,
  };
}
