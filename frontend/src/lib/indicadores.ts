import { categoriaDe, cuentaDe, eventoDe } from "./queries";
import type { Transaccion } from "./types";

// Cálculos de los indicadores de la pestaña Resumen (VistaResumen). Todo se
// mide sobre un PERIODO: una lista de meses de calendario. Sin filtro, el
// periodo son los últimos 3 meses completos (el mes en curso no cuenta
// porque los estados de cuenta llegan a mes vencido); con el filtro de
// meses de la pestaña, es exactamente el rango elegido. Cada indicador se
// calcula solo con los meses del periodo, y las comparaciones son contra el
// periodo anterior de la misma duración (agosto vs. julio, jun–ago vs.
// mar–may) -- así nada se divide entre meses que el usuario no eligió.

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

/** Filtro de meses (periodo) de la pestaña Resumen ("YYYY-MM", o "" = sin
 * elegir) -- vive en `Dashboard` (junto a `categoriasOcultas`) para no
 * perderse al cambiar de pestaña. Solo meses, no fechas: el usuario revisa
 * sus finanzas mes a mes, y un día suelto partía meses a la mitad. */
export interface RangoMeses {
  desde: string;
  hasta: string;
}

export const RANGO_MESES_VACIO: RangoMeses = { desde: "", hasta: "" };

/** Meses que abarca el periodo por defecto (sin filtro). */
export const MESES_PERIODO_POR_DEFECTO = 3;

// Un mes como número consecutivo (año * 12 + mes 0-indexado) para poder
// sumar/restar meses sin pasar por Date/toISOString (que convierte a UTC y
// puede correr el mes).
function indiceDe(mes: string): number {
  const [anio, m] = mes.split("-").map(Number);
  return anio * 12 + (m - 1);
}

function mesDeIndice(indice: number): string {
  const anio = Math.floor(indice / 12);
  return `${anio}-${String(indice - anio * 12 + 1).padStart(2, "0")}`;
}

/** `cantidad` meses consecutivos que terminan en `ultimo`, del más antiguo
 * al más reciente. */
export function mesesHasta(ultimo: string, cantidad: number): string[] {
  const fin = indiceDe(ultimo);
  return Array.from({ length: Math.max(cantidad, 0) }, (_, i) => mesDeIndice(fin - cantidad + 1 + i));
}

/** El mes de calendario de `hoy` ("YYYY-MM"). */
export function mesActual(hoy = new Date()): string {
  return mesDeIndice(hoy.getFullYear() * 12 + hoy.getMonth());
}

/** Los `cantidad` meses completos anteriores al mes en curso (el último es
 * el mes pasado). */
export function mesesCompletos(cantidad: number, hoy = new Date()): string[] {
  return mesesHasta(mesDeIndice(indiceDe(mesActual(hoy)) - 1), cantidad);
}

export interface Periodo {
  /** Meses del periodo, del más antiguo al más reciente. */
  meses: string[];
  /** Los meses inmediatamente anteriores, misma cantidad -- contra ellos se
   * comparan las variaciones. */
  anteriores: string[];
  /** true si no hay filtro (periodo por defecto: últimos 3 meses completos). */
  porDefecto: boolean;
}

/** Periodo a partir del filtro. Si solo se eligió un extremo, el periodo es
 * ese único mes; si vienen invertidos, se ordenan. */
export function resolverPeriodo(rango: RangoMeses, hoy = new Date()): Periodo {
  let meses: string[];
  if (!rango.desde && !rango.hasta) {
    meses = mesesCompletos(MESES_PERIODO_POR_DEFECTO, hoy);
  } else {
    const a = indiceDe(rango.desde || rango.hasta);
    const b = indiceDe(rango.hasta || rango.desde);
    const [inicio, fin] = a <= b ? [a, b] : [b, a];
    meses = mesesHasta(mesDeIndice(fin), fin - inicio + 1);
  }
  return {
    meses,
    anteriores: mesesHasta(mesDeIndice(indiceDe(meses[0]) - 1), meses.length),
    porDefecto: !rango.desde && !rango.hasta,
  };
}

const formatoMesLargo = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" });
const formatoMesCorto = new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric" });

/** Solo las transacciones de los meses dados. */
export function enMeses(transacciones: Transaccion[], meses: string[]): Transaccion[] {
  const conjunto = new Set(meses);
  return transacciones.filter((t) => conjunto.has(mesDe(t)));
}

/** Rango de meses para un año elegido con clic (vista por años): de su
 * primer a su último mes con datos -- no enero–diciembre, para que los
 * meses sin estados de cuenta (antes del primero, o el resto del año en
 * curso) no cuenten como $0 y abaraten los promedios. */
export function rangoDeAnio(anio: string, mesesConDatos: string[]): RangoMeses {
  const delAnio = mesesConDatos.filter((m) => m.startsWith(`${anio}-`)).sort();
  if (delAnio.length === 0) return { desde: `${anio}-01`, hasta: `${anio}-12` };
  return { desde: delAnio[0], hasta: delAnio[delAnio.length - 1] };
}

export interface GastoHormiga {
  cantidad: number;
  total: number;
  /** Parte del gasto del periodo; null si no hubo gasto. */
  proporcion: number | null;
}

/** Cargos de menos de `UMBRAL_GASTO_HORMIGA` en los meses del periodo. */
export function calcularGastoHormiga(transacciones: Transaccion[], meses: string[]): GastoHormiga {
  const delPeriodo = enMeses(transacciones, meses).filter((t) => t.tipo === "cargo");
  const hormigas = delPeriodo.filter((t) => t.monto < UMBRAL_GASTO_HORMIGA);
  const total = hormigas.reduce((s, t) => s + t.monto, 0);
  const gastos = delPeriodo.reduce((s, t) => s + t.monto, 0);
  return { cantidad: hormigas.length, total, proporcion: gastos > 0 ? total / gastos : null };
}

/** "agosto de 2026" → "agosto 2026". */
export function nombreMes(mes: string, corto = false): string {
  const [anio, m] = mes.split("-").map(Number);
  return (corto ? formatoMesCorto : formatoMesLargo).format(new Date(anio, m - 1, 1)).replace(" de ", " ");
}

/** "agosto 2026" para un mes, "jun 2026 – ago 2026" para varios. */
export function nombrePeriodo(meses: string[]): string {
  if (meses.length === 1) return nombreMes(meses[0]);
  return `${nombreMes(meses[0], true)} – ${nombreMes(meses[meses.length - 1], true)}`;
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
 * distintos de los `VENTANA_RECURRENTES` meses que terminan en `ultimoMes`
 * (el último mes del periodo) y con actividad en alguno
 * de los 2 últimos meses (si dejó de cobrarse hace meses, ya no es un gasto
 * fijo vigente). `montoMensual` = total en la ventana / meses con cargo. Se
 * agrupa por `comercio` (no por descripción cruda, que trae referencias
 * distintas en cada cargo), así que solo detecta lo que las reglas de
 * categorización ya etiquetan con comercio. Los cargos con evento asociado
 * se ignoran (son gastos puntuales). Es la única métrica que mira
 * fuera del periodo: detectar "se repite cada mes" necesita historial, así
 * que con un periodo de un mes igual revisa los 6 meses hasta ese mes.
 */
export function detectarGastosRecurrentes(
  transacciones: Transaccion[],
  ultimoMes: string
): GastoRecurrente[] {
  const ventana = new Set(mesesHasta(ultimoMes, VENTANA_RECURRENTES));
  const recientes = new Set(mesesHasta(ultimoMes, 2));
  const porComercio = new Map<string, { meses: Set<string>; total: number }>();

  for (const t of transacciones) {
    // Un cargo asociado a un evento (viaje, fiesta) es un gasto puntual por
    // definición, aunque el comercio se repita (p. ej. el mismo restaurante
    // en un viaje): no cuenta ni para detectar recurrencia ni para el monto.
    if (t.tipo !== "cargo" || !t.comercio || !ventana.has(mesDe(t)) || eventoDe(t) !== null) {
      continue;
    }
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
  /** Gasto mensual promedio de la categoría en el periodo. */
  promedioPeriodo: number;
  /** Gasto mensual promedio en el periodo anterior de la misma duración. */
  promedioAnterior: number;
  diferencia: number;
}

/** Categorías cuyo gasto mensual promedio en el periodo supera el del
 * periodo anterior, ordenadas por el aumento en pesos. */
export function categoriasEnAlza(transacciones: Transaccion[], periodo: Periodo): CategoriaEnAlza[] {
  const actuales = new Set(periodo.meses);
  const anteriores = new Set(periodo.anteriores);
  const porCategoria = new Map<string, { actual: number; anterior: number }>();

  for (const t of transacciones) {
    if (t.tipo !== "cargo") continue;
    const mes = mesDe(t);
    const enActual = actuales.has(mes);
    if (!enActual && !anteriores.has(mes)) continue;
    const categoria = categoriaDe(t);
    const acumulado = porCategoria.get(categoria) ?? { actual: 0, anterior: 0 };
    if (enActual) acumulado.actual += t.monto;
    else acumulado.anterior += t.monto;
    porCategoria.set(categoria, acumulado);
  }

  const n = periodo.meses.length;
  return Array.from(porCategoria.entries())
    .map(([categoria, a]) => {
      const promedioPeriodo = a.actual / n;
      const promedioAnterior = a.anterior / n;
      return { categoria, promedioPeriodo, promedioAnterior, diferencia: promedioPeriodo - promedioAnterior };
    })
    .filter((c) => c.diferencia > 0)
    .sort((a, b) => b.diferencia - a.diferencia);
}

/** Gasto (cargos) de cada categoría en cada mes de `meses`, en el mismo
 * orden -- alimenta las minigráficas de tendencia de "Categorías al alza".
 * Un mes sin cargos es $0 (la línea baja a cero, no se interrumpe). */
export function gastoMensualPorCategoria(
  transacciones: Transaccion[],
  categorias: string[],
  meses: string[]
): Map<string, number[]> {
  const indiceMes = new Map(meses.map((m, i) => [m, i]));
  const series = new Map(categorias.map((c) => [c, meses.map(() => 0)]));
  for (const t of transacciones) {
    if (t.tipo !== "cargo") continue;
    const i = indiceMes.get(mesDe(t));
    const serie = series.get(categoriaDe(t));
    if (i === undefined || !serie) continue;
    serie[i] += t.monto;
  }
  return series;
}

/** Saldo más reciente, al cierre de `hastaMes` (inclusive), de cada cuenta
 * que reporta saldo (las TDC no traen saldo por renglón, así que solo
 * cuentan cuentas de débito/cheques). null si ninguna cuenta tiene saldo. */
export function saldoDisponible(transacciones: Transaccion[], hastaMes: string): number | null {
  const ultimoPorCuenta = new Map<string, { fecha: string; saldo: number }>();
  for (const t of transacciones) {
    if (t.saldo === null || mesDe(t) > hastaMes) continue;
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
 * categorías va el gasto. Totales de los meses del periodo.
 */
export function calcularFlujoSankey(transacciones: Transaccion[], meses: string[]): FlujoSankeyDatos {
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

/** Mínimo de meses que muestra la gráfica de flujo neto: aunque el periodo
 * sea de un mes, se ve en contexto de los meses previos. */
const MESES_GRAFICA_MINIMOS = 12;

export interface Indicadores {
  periodo: Periodo;
  /** Meses para la gráfica de flujo neto: al menos 12, terminando en el
   * último mes del periodo (los del periodo se resaltan). */
  serie: ResumenMes[];
  tasaAhorro: number | null;
  tasaAhorroAnterior: number | null;
  /** Tasa de ahorro de los 12 meses que terminan con el periodo, como
   * referencia de largo plazo. */
  tasaAhorro12m: number | null;
  flujoNetoPromedio: number;
  /** Gasto mensual promedio del periodo (con un mes, el gasto de ese mes). */
  gastoPromedio: number;
  /** Gasto mensual promedio de los (hasta) 12 meses previos al periodo;
   * null si no hay historial antes del periodo. */
  gastoPromedioReferencia: number | null;
  recurrentes: GastoRecurrente[];
  totalRecurrenteMensual: number;
  /** Meses de gasto promedio del periodo que cubre el saldo al cierre. */
  mesesDeCobertura: number | null;
  saldoAlCierre: number | null;
}

/** Indicadores de salud financiera del periodo (tasa de ahorro, flujo
 * neto, gasto promedio, cobertura, recurrentes). `transacciones` ya debe
 * venir sin las categorías ocultas, pero SIN los filtros por clic
 * (categoría, comercio, cuenta, tarjeta, evento): estos indicadores
 * describen tus finanzas completas -- una tasa de ahorro de solo "Comida"
 * no significa nada. El detalle de gasto (hormiga, categorías al alza,
 * Sankey) sí se calcula aparte con las transacciones ya filtradas. `saldo` se
 * calcula aparte (ver `saldoDisponible`) sobre el conjunto sin excluir: es
 * un hecho de la cuenta, no un agregado que dependa de qué categorías se
 * cuentan como gasto. */
export function calcularIndicadores(
  transacciones: Transaccion[],
  saldo: number | null,
  periodo: Periodo
): Indicadores {
  const n = periodo.meses.length;
  const ultimoMes = periodo.meses[n - 1];
  const actual = sumar(resumenPorMes(transacciones, periodo.meses));
  const anterior = sumar(resumenPorMes(transacciones, periodo.anteriores));
  const doceMeses = sumar(resumenPorMes(transacciones, mesesHasta(ultimoMes, 12)));
  // Solo meses desde el primer estado de cuenta: antes de eso no hay datos
  // (no es que se gastara $0), y contarlos como $0 abarataba el promedio
  // de referencia cuando el historial es de menos de un año.
  const primerMes = transacciones.reduce((min, t) => (mesDe(t) < min ? mesDe(t) : min), ultimoMes);
  const mesesReferencia = mesesHasta(mesDeIndice(indiceDe(periodo.meses[0]) - 1), 12).filter(
    (m) => m >= primerMes
  );
  const referencia = sumar(resumenPorMes(transacciones, mesesReferencia));

  const recurrentes = detectarGastosRecurrentes(transacciones, ultimoMes);

  const gastoPromedio = actual.gastos / n;

  return {
    periodo,
    serie: resumenPorMes(transacciones, mesesHasta(ultimoMes, Math.max(n, MESES_GRAFICA_MINIMOS))),
    tasaAhorro: tasaDeAhorro(actual.ingresos, actual.gastos),
    tasaAhorroAnterior: tasaDeAhorro(anterior.ingresos, anterior.gastos),
    tasaAhorro12m: tasaDeAhorro(doceMeses.ingresos, doceMeses.gastos),
    flujoNetoPromedio: (actual.ingresos - actual.gastos) / n,
    gastoPromedio,
    gastoPromedioReferencia: mesesReferencia.length > 0 ? referencia.gastos / mesesReferencia.length : null,
    recurrentes,
    totalRecurrenteMensual: recurrentes.reduce((s, r) => s + r.montoMensual, 0),
    mesesDeCobertura: saldo !== null && gastoPromedio > 0 ? saldo / gastoPromedio : null,
    saldoAlCierre: saldo,
  };
}
