import type { Vela } from "../../../functions/api/cotizaciones";

export type { Vela };

/** Giro del precio (fractal): máximo o mínimo local con su vela de origen. */
export interface Pivote {
  /** Posición en la serie analizada. */
  indice: number;
  fecha: string;
  tipo: "maximo" | "minimo";
  /** Máximo de la vela (si es "maximo") o mínimo (si es "minimo"). */
  precio: number;
  /** La vela exacta que lo origina (fecha, OHLC, volumen). */
  vela: Vela;
}

export type Calidad = "alta" | "media" | "baja";

/** Una regla de un patrón y si se cumplió. Las obligatorias se cumplen todas
 * (si no, el patrón no existe); las demás solo afectan a la calidad. */
export interface Regla {
  texto: string;
  cumple: boolean;
  obligatoria: boolean;
  /** Los valores medidos ("hombros: 2.1% de diferencia"). */
  detalle?: string;
}

export interface PuntoClave {
  indice: number;
  fecha: string;
  precio: number;
  /** Texto corto que se dibuja junto al punto ("Cabeza", "X", "B"...). */
  etiqueta: string;
  /** Solo se dibuja el punto, sin su texto (los toques de un rectángulo: la zona
   * ya dice su rango y la gráfica se llenaría de "Techo 1, Piso 2..."). El texto
   * sigue en el tooltip nativo y en el panel de trazabilidad. */
  silencioso?: boolean;
  vela: Vela;
}

export interface Extremo {
  fecha: string;
  precio: number;
}

/** Segmento a dibujar sobre el precio. */
export interface Segmento {
  desde: Extremo;
  hasta: Extremo;
  /** "llave": corchete bajo la taza/asa (tres segmentos; la etiqueta va en el horizontal). */
  estilo: "neckline" | "objetivo" | "guia" | "mastil" | "ajuste" | "llave";
  etiqueta?: string;
}

/** Zona sombreada (rectángulo, bandera). */
export interface ZonaPatron {
  desdeFecha: string;
  hastaFecha: string;
  minimo: number;
  maximo: number;
  etiqueta?: string;
}

export type FamiliaPatron = "rectangulo" | "hch" | "bandera" | "taza" | "murcielago" | "doble";

export interface Patron {
  /** Estable entre renders: familia + tipo + fechas. */
  id: string;
  familia: FamiliaPatron;
  /** Nombre en español: "Hombro-cabeza-hombro invertido", "Bandera alcista"... */
  nombre: string;
  sesgo: "alcista" | "bajista" | "neutral";
  indiceInicio: number;
  indiceFin: number;
  fechaInicio: string;
  fechaFin: string;
  puntos: PuntoClave[];
  segmentos: Segmento[];
  zonas: ZonaPatron[];
  /** Cierre que confirmó la ruptura, si la hubo. */
  ruptura: { fecha: string; precio: number; volumenRelativo: number | null; direccion: "arriba" | "abajo" } | null;
  objetivo: { precio: number; descripcion: string } | null;
  reglas: Regla[];
  /** 0 a 1: fracción (ponderada) de las reglas de calidad cumplidas. */
  puntaje: number;
  calidad: Calidad;
  /** Velas exactas que lo originan (puntos clave + ruptura), sin repetir. */
  velasOrigen: Vela[];
}
