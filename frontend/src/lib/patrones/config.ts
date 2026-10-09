// ============================================================================
// PARÁMETROS DE DETECCIÓN -- el único archivo que hay que tocar para afinar
// soportes/resistencias, volumen y patrones chartistas. Nada de esto está
// repetido en los detectores: todos leen este objeto (y las pruebas lo pasan
// por parámetro para probar variantes sin tocar los valores reales).
//
// Convención: las fracciones son fracciones (0.05 = 5%). "pivote" = fractal:
// el máximo (o mínimo) de `pivotes.ventana` velas a cada lado.
// ============================================================================

export const CONFIG_DETECCION = {
  pivotes: {
    /** Velas a cada lado para que una vela sea pivote (5 = ventana de 11). */
    ventana: 5,
  },

  atr: {
    /** Periodo del ATR con el que se miden las tolerancias de los niveles. */
    periodo: 14,
  },

  volumen: {
    /** Sesiones del promedio de volumen. */
    ventanaPromedio: 20,
    /** Un día es de "volumen alto" si supera este múltiplo del promedio. */
    umbralAlto: 1.5,
  },

  /** Soportes y resistencias (se calculan con las últimas `sesiones`, sin
   * depender del zoom de la gráfica). */
  niveles: {
    sesiones: 126,
    /** Pivotes a menos de esta fracción del ATR se juntan en una zona. */
    agruparAtr: 0.75,
    /** Una media a menos de esta fracción del ATR de una zona la absorbe. */
    fusionarSmaAtr: 0.5,
    /** Medio ancho mínimo de una zona, como fracción del precio (±0.25%). */
    medioAnchoMinimo: 0.0025,
    /** Toques mínimos de una zona de pivotes para llamarla "estructural". */
    minToquesEstructural: 2,
  },

  /** Puntaje (0 a 1) mínimo de cada nivel de calidad de un patrón. */
  calidad: { alta: 0.75, media: 0.5 },

  /** Máximo de detecciones por familia que se dibujan (las más recientes). */
  maximoPorFamilia: 4,

  rectangulo: {
    minToquesPorLado: 2,
    /** (techo - piso) / piso máximo: más ancho que esto ya no es un rango. */
    anchoMaximo: 0.1,
    minSesiones: 20,
    /** Un pivote es "toque" de un borde si está a menos de esta fracción del precio. */
    toleranciaBorde: 0.012,
    /** El cierre debe quedar al menos esta fracción fuera del borde para ser ruptura. */
    margenRuptura: 0.003,
    /** Sesiones después del último toque en las que se busca la ruptura. */
    sesionesParaRuptura: 10,
  },

  hch: {
    /** |hombro izq. - hombro der.| / promedio de los hombros. */
    toleranciaHombros: 0.05,
    /** La cabeza debe superar a los dos hombros por al menos esta fracción. */
    ventajaCabeza: 0.01,
    /** Sesiones máximas desde el hombro derecho para que cierre bajo la neckline. */
    sesionesParaRuptura: 15,
    minSesiones: 15,
    maxSesiones: 150,
    /** Simetría en el tiempo: |sesiones hombro izq.-cabeza menos cabeza-hombro der.| / total. */
    simetriaTiempoMax: 0.35,
  },

  bandera: {
    /** Movimiento mínimo del mástil (fracción) ... */
    minMastil: 0.08,
    /** ... en como máximo estas sesiones. */
    maxSesionesMastil: 15,
    /** La bandera no puede retroceder más de esta fracción del mástil. */
    maxRetroceso: 0.5,
    minSesionesBandera: 4,
    maxSesionesBandera: 20,
    /** Retroceso "ideal" (calidad): una bandera que retrocede menos de esto es más sana. */
    retrocesoIdeal: 0.382,
  },

  taza: {
    /** R² mínimo del ajuste parabólico de la taza. */
    minR2: 0.8,
    profundidadMin: 0.12,
    profundidadMax: 0.35,
    minSesionesTaza: 30,
    maxSesionesTaza: 160,
    /** |borde izq. - borde der.| / borde izq. máximo. */
    toleranciaBordes: 0.07,
    /** El asa no puede retroceder más de esta fracción de la subida de la taza. */
    maxRetrocesoAsa: 0.5,
    minSesionesAsa: 5,
    maxSesionesAsa: 30,
    /** El fondo de la taza debe caer entre estas fracciones de su ancho (redondeada y centrada). */
    fondoCentro: [0.25, 0.75] as [number, number],
    /** Base redondeada: en la mitad central de la taza ningún cierre sube más de
     * esta fracción de la profundidad sobre el fondo (una parábola llega a 0.25;
     * una "V" a 0.5: sin esta regla una V también pasaría el R²). */
    baseRedondaMax: 0.35,
    /** El asa debe bajar al menos esta fracción del precio (si no, no hay asa). */
    asaRetrocesoMinPct: 0.01,
    /** Retroceso "ideal" del asa (calidad). */
    asaRetrocesoIdeal: 0.33,
  },

  murcielago: {
    /** Tolerancia RELATIVA (±3%) sobre cada proporción de Fibonacci. */
    tolerancia: 0.03,
    /** B retrocede entre estos múltiplos del tramo XA. */
    b: [0.382, 0.5] as [number, number],
    /** D = este múltiplo de XA (retroceso de 0.886). */
    d: 0.886,
    /** CD = entre estos múltiplos de BC. */
    cd: [1.618, 2.618] as [number, number],
  },

  doble: {
    /** |techo 1 - techo 2| / promedio máximo. */
    tolerancia: 0.015,
    minSeparacion: 10,
    maxSeparacion: 80,
    /** Profundidad mínima del valle entre los dos (fracción del techo). */
    profundidadMin: 0.03,
    sesionesParaRuptura: 20,
  },
};

export type ConfigDeteccion = typeof CONFIG_DETECCION;
