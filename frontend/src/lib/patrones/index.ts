import type { PuntoTecnico } from "../tecnico";
import { detectarBanderas } from "./bandera";
import { CONFIG_DETECCION, type ConfigDeteccion } from "./config";
import { detectarDobles } from "./dobles";
import { detectarHch } from "./hch";
import { detectarMurcielagos } from "./murcielago";
import { detectarRectangulos } from "./rectangulo";
import { detectarTazas } from "./taza";
import type { FamiliaPatron, Patron } from "./tipos";

export { CONFIG_DETECCION } from "./config";
export type { ConfigDeteccion } from "./config";
export { alternarPivotes, detectarPivotes } from "./pivotes";
export * from "./tipos";

/** Familias en el orden de los botones de la gráfica. */
export const FAMILIAS: { id: FamiliaPatron; etiqueta: string }[] = [
  { id: "rectangulo", etiqueta: "Rectángulo" },
  { id: "hch", etiqueta: "Hombro-cabeza-hombro" },
  { id: "bandera", etiqueta: "Bandera" },
  { id: "taza", etiqueta: "Taza con asa" },
  { id: "murcielago", etiqueta: "Murciélago" },
  { id: "doble", etiqueta: "Doble techo/piso" },
];

export type PatronesDetectados = Record<FamiliaPatron, Patron[]>;

/**
 * Corre todos los detectores sobre `puntos` (la serie visible) y deja, por
 * familia, las `maximoPorFamilia` detecciones más recientes. Un patrón solo
 * aparece si cumple todas sus reglas obligatorias: no se fuerza nada.
 */
export function detectarPatrones(
  puntos: PuntoTecnico[],
  config: ConfigDeteccion = CONFIG_DETECCION
): PatronesDetectados {
  const recientes = (patrones: Patron[]) =>
    [...patrones].sort((a, b) => b.indiceFin - a.indiceFin).slice(0, config.maximoPorFamilia).reverse();
  return {
    rectangulo: recientes(detectarRectangulos(puntos, config)),
    hch: recientes(detectarHch(puntos, config)),
    bandera: recientes(detectarBanderas(puntos, config)),
    taza: recientes(detectarTazas(puntos, config)),
    murcielago: recientes(detectarMurcielagos(puntos, config)),
    doble: recientes(detectarDobles(puntos, config)),
  };
}
