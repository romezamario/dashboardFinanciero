// Promedios de gasto mensual que se dibujan sobre la gráfica de barras de la
// pestaña Shophunters (los mismos tres de la gráfica de "Categorías y
// Comercios": promedio móvil de 3 meses y promedios planos de los últimos 3 y
// 12 meses) y las medidas de la columna de etiquetas que comparten las dos
// gráficas. Funciones puras, sin React.

/** Ancho (px) de la columna de la derecha donde las gráficas con promedios escriben el
 * nombre y el valor de cada línea (`EtiquetasPromedios`); la gráfica lo reserva como margen derecho. */
export const ANCHO_COLUMNA_PROMEDIOS = 184;
/** Separación vertical mínima (px) entre dos etiquetas de esa columna: dos renglones de texto. */
export const ALTO_ETIQUETA_PROMEDIO = 30;

export interface PromediosDeGastos {
  /** Promedio móvil de `ventana` meses completos, alineado con los puntos (null donde no hay
   * `ventana` meses completos desde el primer gasto, y en el mes en curso). */
  movil: (number | null)[];
  /** Promedio de los últimos 3 meses COMPLETOS (null sin ninguno). */
  ultimos3: number | null;
  /** Promedio de los últimos 12 meses completos (los que haya, si son menos de 12). */
  ultimos12: number | null;
  /** Último punto del promedio móvil (para su etiqueta). */
  ultimoMovil: number | null;
}

const media = (valores: number[]) => valores.reduce((a, b) => a + b, 0) / valores.length;

/**
 * Promedios de una serie mensual de montos (el más antiguo primero) **desde el primer mes con
 * gasto**: los meses anteriores en $0 no son meses de gasto cero sino meses en los que ese
 * gasto todavía no existía (un evento que empezó hace dos meses, una categoría nueva), y
 * bajarían el promedio de "los últimos 12 meses" a la mitad. Un mes en $0 *después* del primer
 * gasto sí cuenta: ahí de verdad no se gastó. El promedio móvil (`ventana` meses) arranca
 * cuando hay `ventana` meses desde ese primer gasto; antes es null. Sin ningún gasto, todo null.
 */
export function promediosDesdeElPrimerGasto(montos: number[], ventana = 3): PromediosDeGastos {
  const primero = montos.findIndex((m) => m > 0);
  const desdeElPrimero = primero < 0 ? [] : montos.slice(primero);
  const movilDesdeElPrimero = desdeElPrimero.map((_, i) =>
    i < ventana - 1 ? null : media(desdeElPrimero.slice(i - ventana + 1, i + 1))
  );
  return {
    // Alineado con TODOS los meses: null antes del primer gasto.
    movil: montos.map((_, i) => (primero >= 0 && i >= primero ? movilDesdeElPrimero[i - primero] : null)),
    ultimos3: desdeElPrimero.length === 0 ? null : media(desdeElPrimero.slice(-3)),
    ultimos12: desdeElPrimero.length === 0 ? null : media(desdeElPrimero.slice(-12)),
    ultimoMovil:
      movilDesdeElPrimero.length === 0 ? null : movilDesdeElPrimero[movilDesdeElPrimero.length - 1],
  };
}

/**
 * Lo mismo para una serie que llega hasta el mes en curso (`mesEnCurso`, "YYYY-MM"), que no
 * entra a ningún promedio: sus estados de cuenta aún no llegan, así que su gasto está a medias y
 * bajaría el promedio de los últimos meses (igual que el resto del dashboard, que cuenta solo
 * meses completos). Su barra sí se dibuja, sin promedio móvil.
 */
export function promediosDeGastos(
  puntos: { periodo: string; gastos: number }[],
  mesEnCurso: string,
  ventana = 3
): PromediosDeGastos {
  const delPeriodo = puntos.filter((p) => p.periodo < mesEnCurso);
  const r = promediosDesdeElPrimerGasto(
    delPeriodo.map((p) => p.gastos),
    ventana
  );
  // Los puntos del mes en curso en adelante no tienen promedio móvil.
  return { ...r, movil: puntos.map((_, i) => (i < delPeriodo.length ? r.movil[i] : null)) };
}

