import { categoriaDe, cuentaDe } from "./queries";
import { enMeses, type Periodo } from "./indicadores";
import type { Transaccion } from "./types";

// Comparativo entre tarjetas de crédito (pestaña "Tarjetas de crédito"). Una
// "tarjeta" aquí es una CUENTA de TDC (`cuentas.alias`: "TDC Beyond",
// "Invex TDC"...), no `transacciones.tarjeta` (Titular/Adicional).
// Uso de una tarjeta = sus CARGOS (compras, comisiones, disposiciones); los
// abonos son pagos y devoluciones, y se reportan aparte -- sumarlos al gasto
// lo neutralizaría.

/** Una cuenta es tarjeta de crédito si su banco o su alias dicen "TDC": los
 * nombres de banco vienen del registro de parsers de la app de escritorio
 * ("Banamex TDC", "Invex TDC"), así que la cuenta de cheques ("Banamex",
 * alias "Priority") queda fuera. */
export function esTarjetaCredito(t: Transaccion): boolean {
  const { alias, bancos } = t.documentos.cuentas;
  return /\btdc\b/i.test(bancos.nombre) || /\btdc\b/i.test(alias);
}

// Paleta categórica validada (dataviz, slots 1-4, ver index.css): el color
// sigue a la TARJETA, nunca a su posición en un ranking -- quien llama
// asigna el slot por orden alfabético fijo de todas las tarjetas, así que
// "TDC Beyond" es del mismo color en todas las gráficas y periodos.
const COLORES_TARJETA = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

/** Color de la tarjeta en la posición `indice` (orden alfabético). Pasadas
 * 4 tarjetas no se inventa un 5º tono (rompería la validación de color):
 * cae al gris de texto atenuado y la etiqueta directa carga la identidad.
 * Si algún día hay una 5ª tarjeta, agrega --series-5 validado. */
export function colorTarjeta(indice: number): string {
  return COLORES_TARJETA[indice] ?? "var(--text-muted)";
}

// Cargos de $0.00: los estados de cuenta Invex (formato V2) traen líneas de
// eco/anotación que se extraen como renglones de $0 (ver CLAUDE.md) -- no
// son compras y no deben contar en número de compras ni ticket promedio.
const esCompra = (t: Transaccion) => t.tipo === "cargo" && t.monto > 0;

export interface ComparativoTarjeta {
  tarjeta: string;
  gasto: number;
  /** Parte del gasto total de todas las tarjetas en el periodo. */
  proporcion: number | null;
  compras: number;
  ticketPromedio: number | null;
  /** Abonos del periodo: pagos a la tarjeta y devoluciones. */
  pagos: number;
  gastoAnterior: number;
  /** Cambio vs. el periodo anterior de la misma duración; null sin base. */
  variacion: number | null;
  categoriaPrincipal: { nombre: string; monto: number } | null;
  /** Gasto por mes en `mesesSerie`, para la minigráfica de tendencia. */
  serie: number[];
}

export function compararTarjetas(
  transacciones: Transaccion[],
  tarjetas: string[],
  periodo: Periodo,
  mesesSerie: string[]
): ComparativoTarjeta[] {
  const actuales = new Set(periodo.meses);
  const anteriores = new Set(periodo.anteriores);
  const indiceSerie = new Map(mesesSerie.map((m, i) => [m, i]));

  const porTarjeta = new Map(
    tarjetas.map((tarjeta) => [
      tarjeta,
      {
        gasto: 0,
        compras: 0,
        pagos: 0,
        gastoAnterior: 0,
        porCategoria: new Map<string, number>(),
        serie: mesesSerie.map(() => 0),
      },
    ])
  );

  for (const t of transacciones) {
    const acumulado = porTarjeta.get(cuentaDe(t));
    if (!acumulado) continue;
    const mes = t.fecha.slice(0, 7);
    if (esCompra(t)) {
      const i = indiceSerie.get(mes);
      if (i !== undefined) acumulado.serie[i] += t.monto;
      if (actuales.has(mes)) {
        acumulado.gasto += t.monto;
        acumulado.compras += 1;
        const categoria = categoriaDe(t);
        acumulado.porCategoria.set(categoria, (acumulado.porCategoria.get(categoria) ?? 0) + t.monto);
      } else if (anteriores.has(mes)) {
        acumulado.gastoAnterior += t.monto;
      }
    } else if (t.tipo === "abono" && actuales.has(mes)) {
      acumulado.pagos += t.monto;
    }
  }

  const gastoTotal = Array.from(porTarjeta.values()).reduce((s, a) => s + a.gasto, 0);

  return tarjetas.map((tarjeta) => {
    const a = porTarjeta.get(tarjeta)!;
    const [nombre, monto] =
      Array.from(a.porCategoria.entries()).sort((x, y) => y[1] - x[1])[0] ?? [];
    return {
      tarjeta,
      gasto: a.gasto,
      proporcion: gastoTotal > 0 ? a.gasto / gastoTotal : null,
      compras: a.compras,
      ticketPromedio: a.compras > 0 ? a.gasto / a.compras : null,
      pagos: a.pagos,
      gastoAnterior: a.gastoAnterior,
      variacion: a.gastoAnterior > 0 ? (a.gasto - a.gastoAnterior) / a.gastoAnterior : null,
      categoriaPrincipal: nombre !== undefined ? { nombre, monto: monto! } : null,
      serie: a.serie,
    };
  });
}

/** Una fila por mes con el gasto de cada tarjeta como columna (clave = alias
 * de la tarjeta) -- el formato que espera una gráfica de barras apiladas. */
export type FilaPorTarjeta = { etiqueta: string } & Record<string, number | string>;

export function gastoMensualPorTarjeta(
  transacciones: Transaccion[],
  tarjetas: string[],
  meses: string[]
): FilaPorTarjeta[] {
  const filas = new Map<string, FilaPorTarjeta>(
    meses.map((mes) => [mes, { etiqueta: mes, ...Object.fromEntries(tarjetas.map((t) => [t, 0])) }])
  );
  const conjuntoTarjetas = new Set(tarjetas);
  for (const t of transacciones) {
    const fila = filas.get(t.fecha.slice(0, 7));
    const tarjeta = cuentaDe(t);
    if (!fila || !esCompra(t) || !conjuntoTarjetas.has(tarjeta)) continue;
    fila[tarjeta] = (fila[tarjeta] as number) + t.monto;
  }
  return meses.map((m) => filas.get(m)!);
}

export const TOPE_CATEGORIAS_TARJETAS = 8;
export const OTRAS_CATEGORIAS = "Otras";

/** Gasto del periodo por categoría, partido por tarjeta: qué tarjeta usas
 * para qué. Las categorías se ordenan por gasto total; pasadas las primeras
 * `TOPE_CATEGORIAS_TARJETAS` se pliegan en "Otras" para no saturar el eje. */
export function gastoPorCategoriaYTarjeta(
  transacciones: Transaccion[],
  tarjetas: string[],
  meses: string[]
): FilaPorTarjeta[] {
  const conjuntoTarjetas = new Set(tarjetas);
  const porCategoria = new Map<string, Map<string, number>>();
  for (const t of enMeses(transacciones, meses)) {
    const tarjeta = cuentaDe(t);
    if (!esCompra(t) || !conjuntoTarjetas.has(tarjeta)) continue;
    const categoria = categoriaDe(t);
    const fila = porCategoria.get(categoria) ?? new Map<string, number>();
    fila.set(tarjeta, (fila.get(tarjeta) ?? 0) + t.monto);
    porCategoria.set(categoria, fila);
  }

  const total = (fila: Map<string, number>) => Array.from(fila.values()).reduce((s, v) => s + v, 0);
  const ordenadas = Array.from(porCategoria.entries()).sort((a, b) => total(b[1]) - total(a[1]));
  const visibles = ordenadas.slice(0, TOPE_CATEGORIAS_TARJETAS);
  const resto = ordenadas.slice(TOPE_CATEGORIAS_TARJETAS);
  if (resto.length > 0) {
    const otras = new Map<string, number>();
    for (const [, fila] of resto) {
      for (const [tarjeta, monto] of fila) otras.set(tarjeta, (otras.get(tarjeta) ?? 0) + monto);
    }
    visibles.push([OTRAS_CATEGORIAS, otras]);
  }

  return visibles.map(([categoria, fila]) => ({
    etiqueta: categoria,
    ...Object.fromEntries(tarjetas.map((t) => [t, fila.get(t) ?? 0])),
  }));
}
