import type { PuntoTecnico } from "../tecnico";
import { CONFIG_DETECCION, type ConfigDeteccion } from "./config";
import type { Patron, Regla } from "./tipos";
import { armarPatron, clavePunto, extremo, media, pendiente, sinEncimarse, volumenRelativo } from "./util";

/**
 * Bandera alcista / bajista. Reglas (obligatorias):
 *  - mástil: movimiento de al menos `minMastil` en como máximo
 *    `maxSesionesMastil` sesiones (del mínimo al máximo en la alcista; del
 *    máximo al mínimo en la bajista);
 *  - bandera de `minSesionesBandera` a `maxSesionesBandera` sesiones que
 *    retrocede menos de `maxRetroceso` del mástil (si pasa de ahí es una
 *    corrección, no una bandera) y sin cerrar más allá del extremo del mástil
 *    (si lo hace, esa es la ruptura);
 *  - volumen decreciente durante la bandera (pendiente negativa).
 * De calidad: volumen medio menor que el del mástil, bandera inclinada contra
 * el mástil, retroceso moderado (<= `retrocesoIdeal`), ruptura confirmada por
 * cierre y volumen de la ruptura alto. Objetivo: la altura del mástil
 * proyectada desde el extremo del mástil.
 */
export function detectarBanderas(puntos: PuntoTecnico[], config: ConfigDeteccion = CONFIG_DETECCION): Patron[] {
  const c = config.bandera;
  const n = puntos.length;
  const encontrados: Patron[] = [];

  for (const alcista of [true, false]) {
    const s = alcista ? 1 : -1;
    // Extremo del mástil (alcista: máximo; bajista: mínimo) y el lado opuesto.
    const ext = (i: number) => (alcista ? puntos[i].maximo : puntos[i].minimo);
    const opuesto = (i: number) => (alcista ? puntos[i].minimo : puntos[i].maximo);

    for (let e = 1; e < n - c.minSesionesBandera; e++) {
      // `e` es el extremo de su entorno: nada mejor desde `maxSesionesMastil`
      // antes hasta `minSesionesBandera` después.
      const desde = Math.max(0, e - c.maxSesionesMastil);
      const hasta = Math.min(n - 1, e + c.minSesionesBandera);
      let esExtremo = true;
      for (let j = desde; j <= hasta; j++) if (s * (ext(j) - ext(e)) > 0) esExtremo = false;
      if (!esExtremo) continue;

      // Inicio del mástil: lo más lejano al extremo dentro de la ventana.
      let inicio = desde;
      for (let j = desde; j < e; j++) if (s * (opuesto(j) - opuesto(inicio)) < 0) inicio = j;
      if (inicio >= e) continue;
      const alturaMastil = s * (ext(e) - opuesto(inicio));
      const movimiento = alturaMastil / opuesto(inicio);
      if (alturaMastil <= 0 || movimiento < c.minMastil) continue;

      // Bandera: desde e+1 hasta la ruptura (cierre más allá del extremo) o
      // el final de los datos.
      let fin = e;
      let ruptura = -1;
      let maxRetroceso = 0;
      let fallo = false;
      for (let j = e + 1; j < n; j++) {
        if (s * (puntos[j].cierre - ext(e)) > 0) {
          ruptura = j;
          break;
        }
        maxRetroceso = Math.max(maxRetroceso, (s * (ext(e) - opuesto(j))) / alturaMastil);
        if (maxRetroceso >= c.maxRetroceso || j - e > c.maxSesionesBandera) {
          fallo = true;
          break;
        }
        fin = j;
      }
      if (fallo) continue;
      const largo = fin - e;
      if (largo < c.minSesionesBandera) continue;

      const volBandera = puntos.slice(e + 1, fin + 1).map((p) => p.volumen);
      const volMastil = puntos.slice(inicio, e + 1).map((p) => p.volumen);
      if (pendiente(volBandera) >= 0) continue; // volumen decreciente: obligatoria

      const cierres = puntos.slice(e + 1, fin + 1).map((p) => p.cierre);
      const volRuptura = ruptura >= 0 ? volumenRelativo(puntos[ruptura]) : null;
      const reglas: Regla[] = [
        {
          texto: `Mástil > ${(c.minMastil * 100).toFixed(0)}% en ≤ ${c.maxSesionesMastil} sesiones`,
          cumple: true,
          obligatoria: true,
          detalle: `${(movimiento * 100).toFixed(1)}% en ${e - inicio} sesiones`,
        },
        {
          texto: `Bandera de ${c.minSesionesBandera}–${c.maxSesionesBandera} sesiones`,
          cumple: true,
          obligatoria: true,
          detalle: `${largo} sesiones`,
        },
        {
          texto: `Retroceso < ${(c.maxRetroceso * 100).toFixed(0)}% del mástil`,
          cumple: true,
          obligatoria: true,
          detalle: `${(maxRetroceso * 100).toFixed(0)}%`,
        },
        { texto: "Volumen decreciente en la bandera", cumple: true, obligatoria: true },
        {
          texto: "Volumen medio de la bandera menor al del mástil",
          cumple: media(volBandera) < media(volMastil),
          obligatoria: false,
        },
        {
          texto: "Bandera inclinada contra el mástil",
          cumple: s * pendiente(cierres) < 0,
          obligatoria: false,
        },
        {
          texto: `Retroceso moderado (≤ ${(c.retrocesoIdeal * 100).toFixed(1)}%)`,
          cumple: maxRetroceso <= c.retrocesoIdeal,
          obligatoria: false,
        },
        {
          texto: "Ruptura confirmada por cierre",
          cumple: ruptura >= 0,
          obligatoria: false,
          detalle: ruptura >= 0 ? puntos[ruptura].fecha : "la bandera sigue en formación",
        },
        {
          texto: `Volumen de la ruptura ≥ ${config.volumen.umbralAlto}× el promedio`,
          cumple: volRuptura !== null && volRuptura >= config.volumen.umbralAlto,
          obligatoria: false,
          detalle: volRuptura !== null ? `${volRuptura.toFixed(2)}×` : "sin ruptura",
        },
      ];

      const precioObjetivo = ext(e) + s * alturaMastil;
      const tramo = puntos.slice(e + 1, fin + 1);
      const marcadores = [
        clavePunto(puntos, inicio, opuesto(inicio), "Inicio del mástil"),
        clavePunto(puntos, e, ext(e), "Fin del mástil"),
        clavePunto(puntos, fin, puntos[fin].cierre, "Fin de la bandera"),
      ];
      if (ruptura >= 0) marcadores.push(clavePunto(puntos, ruptura, puntos[ruptura].cierre, "Ruptura"));
      encontrados.push(
        armarPatron(
          {
            familia: "bandera",
            nombre: alcista ? "Bandera alcista" : "Bandera bajista",
            sesgo: alcista ? "alcista" : "bajista",
            indiceInicio: inicio,
            indiceFin: ruptura >= 0 ? ruptura : fin,
            puntos: marcadores,
            segmentos: [
              {
                desde: extremo(puntos, inicio, opuesto(inicio)),
                hasta: extremo(puntos, e, ext(e)),
                estilo: "mastil",
                etiqueta: `Mástil ${alcista ? "+" : "−"}${(movimiento * 100).toFixed(1)}%`,
              },
              {
                desde: extremo(puntos, ruptura >= 0 ? ruptura : fin, precioObjetivo),
                hasta: extremo(puntos, n - 1, precioObjetivo),
                estilo: "objetivo",
                etiqueta: `Objetivo ${precioObjetivo.toFixed(2)}`,
              },
            ],
            zonas: [
              {
                desdeFecha: puntos[e].fecha,
                hastaFecha: puntos[fin].fecha,
                minimo: Math.min(...tramo.map((p) => p.minimo)),
                maximo: Math.max(...tramo.map((p) => p.maximo)),
                etiqueta: "Bandera",
              },
            ],
            ruptura:
              ruptura >= 0
                ? {
                    fecha: puntos[ruptura].fecha,
                    precio: puntos[ruptura].cierre,
                    volumenRelativo: volRuptura,
                    direccion: alcista ? "arriba" : "abajo",
                  }
                : null,
            objetivo: {
              precio: precioObjetivo,
              descripcion: `Altura del mástil (${alturaMastil.toFixed(2)}) proyectada desde su extremo`,
            },
            reglas,
          },
          puntos,
          config,
          ruptura >= 0 ? [puntos[ruptura]] : []
        )
      );
    }
  }
  return sinEncimarse(encontrados);
}
