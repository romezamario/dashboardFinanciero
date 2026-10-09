// Promedios de gasto mensual que se dibujan sobre la gráfica de barras de la
// pestaña Shophunters (los mismos tres de la gráfica de "Categorías y
// Comercios": promedio móvil de 3 meses y promedios planos de los últimos 3 y
// 12 meses). Funciones puras, sin React.

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
 * El mes en curso (`mesEnCurso`, "YYYY-MM") no entra a ningún promedio: sus
 * estados de cuenta aún no llegan, así que su gasto está a medias y bajaría el
 * promedio de los últimos meses (igual que el resto del dashboard, que cuenta
 * solo meses completos). Su barra sí se dibuja, sin promedio móvil.
 *
 * Tampoco cuentan los meses ANTERIORES al primer gasto: en un evento que empezó hace dos
 * meses, los diez meses previos en $0 no son meses de gasto cero sino meses en los que ese
 * gasto todavía no existía, y bajarían el promedio de "los últimos 12 meses" a la mitad.
 */
export function promediosDeGastos(
  puntos: { periodo: string; gastos: number }[],
  mesEnCurso: string,
  ventana = 3
): PromediosDeGastos {
  const delPeriodo = puntos.filter((p) => p.periodo < mesEnCurso);
  const primero = delPeriodo.findIndex((p) => p.gastos > 0);
  // Sin ningún mes con gasto no hay nada que promediar; si no, se parte del primero.
  const completos = primero < 0 ? [] : delPeriodo.slice(primero).map((p) => p.gastos);
  const movilCompletos = completos.map((_, i) =>
    i < ventana - 1 ? null : media(completos.slice(i - ventana + 1, i + 1))
  );
  // Alinea el móvil con TODOS los puntos: null antes del primer gasto y en el mes en curso.
  const inicio = primero < 0 ? delPeriodo.length : primero;
  const movil = puntos.map((p, i) =>
    p.periodo < mesEnCurso && i >= inicio && i - inicio < movilCompletos.length ? movilCompletos[i - inicio] : null
  );
  return {
    movil,
    ultimos3: completos.length === 0 ? null : media(completos.slice(-3)),
    ultimos12: completos.length === 0 ? null : media(completos.slice(-12)),
    ultimoMovil: movilCompletos.length === 0 ? null : movilCompletos[movilCompletos.length - 1],
  };
}

/** "YYYY-MM" de hoy en la zona del navegador (no UTC: de noche en CDMX UTC ya es mañana). */
export function mesActual(hoy: Date = new Date()): string {
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}
