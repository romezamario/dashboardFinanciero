import type { PuntoTecnico } from "../tecnico";
import { CONFIG_DETECCION, type ConfigDeteccion } from "./config";
import { alternarPivotes, detectarPivotes } from "./pivotes";
import type { Patron, Pivote, Regla, Segmento } from "./tipos";
import {
  armarPatron,
  clavePivote,
  clavePunto,
  extremo,
  media,
  pendiente,
  sinEncimarse,
  volumenRelativo,
} from "./util";

/**
 * Rectángulo / rango lateral. Reglas (obligatorias):
 *  - al menos `minToquesPorLado` pivotes en el techo y en el piso (a menos de
 *    `toleranciaBorde` de cada borde);
 *  - ancho (techo - piso) / piso <= `anchoMaximo`;
 *  - al menos `minSesiones` entre el primer y el último toque;
 *  - ningún cierre fuera del rango (con esa misma tolerancia) mientras dura.
 * De calidad: ruptura confirmada por cierre, volumen de la ruptura alto,
 * volumen decreciente dentro del rango y más de 4 toques en total.
 * Objetivo medido: la altura del rango proyectada desde el borde roto.
 */
export function detectarRectangulos(
  puntos: PuntoTecnico[],
  config: ConfigDeteccion = CONFIG_DETECCION
): Patron[] {
  const c = config.rectangulo;
  const pivotes = alternarPivotes(detectarPivotes(puntos, config.pivotes.ventana));
  const encontrados: Patron[] = [];

  for (let s = 0; s < pivotes.length; s++) {
    // Se extiende la ventana mientras siga siendo un rango válido y se queda
    // con la más larga.
    let mejor: { e: number; techo: number; piso: number } | null = null;
    for (let e = s + 3; e < pivotes.length; e++) {
      const tramo = pivotes.slice(s, e + 1);
      const altos = tramo.filter((p) => p.tipo === "maximo");
      const bajos = tramo.filter((p) => p.tipo === "minimo");
      if (altos.length < c.minToquesPorLado || bajos.length < c.minToquesPorLado) continue;
      const techo = media(altos.map((p) => p.precio));
      const piso = media(bajos.map((p) => p.precio));
      const valido =
        altos.every((p) => Math.abs(p.precio - techo) / techo <= c.toleranciaBorde) &&
        bajos.every((p) => Math.abs(p.precio - piso) / piso <= c.toleranciaBorde) &&
        (techo - piso) / piso <= c.anchoMaximo &&
        techo > piso &&
        cierresDentro(puntos, tramo[0].indice, tramo[tramo.length - 1].indice, piso, techo, c.toleranciaBorde);
      if (valido) mejor = { e, techo, piso };
      else if (mejor) break;
    }
    if (!mejor) continue;
    const tramo = pivotes.slice(s, mejor.e + 1);
    const patron = armar(puntos, tramo, mejor.techo, mejor.piso, config);
    if (patron) encontrados.push(patron);
  }
  return sinEncimarse(encontrados);
}

function cierresDentro(
  puntos: PuntoTecnico[],
  desde: number,
  hasta: number,
  piso: number,
  techo: number,
  tolerancia: number
): boolean {
  for (let i = desde; i <= hasta; i++) {
    if (puntos[i].cierre > techo * (1 + tolerancia) || puntos[i].cierre < piso * (1 - tolerancia)) return false;
  }
  return true;
}

function armar(
  puntos: PuntoTecnico[],
  tramo: Pivote[],
  techo: number,
  piso: number,
  config: ConfigDeteccion
): Patron | null {
  const c = config.rectangulo;
  const primero = tramo[0];
  const ultimo = tramo[tramo.length - 1];
  const altos = tramo.filter((p) => p.tipo === "maximo");
  const bajos = tramo.filter((p) => p.tipo === "minimo");
  const alto = techo - piso;

  // Ruptura: primer cierre fuera del rango tras el último toque.
  let ruptura: { indice: number; direccion: "arriba" | "abajo" } | null = null;
  let fin = ultimo.indice;
  for (let i = ultimo.indice + 1; i < puntos.length; i++) {
    if (puntos[i].cierre > techo * (1 + c.margenRuptura)) {
      ruptura = { indice: i, direccion: "arriba" };
      break;
    }
    if (puntos[i].cierre < piso * (1 - c.margenRuptura)) {
      ruptura = { indice: i, direccion: "abajo" };
      break;
    }
    if (i - ultimo.indice <= c.sesionesParaRuptura) fin = i;
  }
  const rompe = ruptura && ruptura.indice - ultimo.indice <= c.sesionesParaRuptura ? ruptura : null;
  const indiceFin = rompe ? rompe.indice : fin;
  const duracion = ultimo.indice - primero.indice + 1;
  // La duración mínima es obligatoria: sin ella no hay patrón.
  if (duracion < c.minSesiones) return null;

  const volumenes = puntos.slice(primero.indice, ultimo.indice + 1).map((p) => p.volumen);
  const volRuptura = rompe ? volumenRelativo(puntos[rompe.indice]) : null;
  const reglas: Regla[] = [
    {
      texto: `≥ ${c.minToquesPorLado} toques por lado`,
      cumple: true,
      obligatoria: true,
      detalle: `${altos.length} en el techo, ${bajos.length} en el piso`,
    },
    {
      texto: `Ancho máximo ${(c.anchoMaximo * 100).toFixed(0)}%`,
      cumple: true,
      obligatoria: true,
      detalle: `${((alto / piso) * 100).toFixed(1)}%`,
    },
    { texto: `Duración ≥ ${c.minSesiones} sesiones`, cumple: true, obligatoria: true, detalle: `${duracion} sesiones` },
    { texto: "Cierres dentro del rango", cumple: true, obligatoria: true },
    {
      texto: "Ruptura confirmada por cierre",
      cumple: rompe !== null,
      obligatoria: false,
      detalle: rompe ? `${rompe.direccion} el ${puntos[rompe.indice].fecha}` : "el precio sigue dentro del rango",
    },
    {
      texto: `Volumen de la ruptura ≥ ${config.volumen.umbralAlto}× el promedio`,
      cumple: volRuptura !== null && volRuptura >= config.volumen.umbralAlto,
      obligatoria: false,
      detalle: volRuptura !== null ? `${volRuptura.toFixed(2)}×` : "sin ruptura",
    },
    {
      texto: "Volumen decreciente dentro del rango",
      cumple: pendiente(volumenes) < 0,
      obligatoria: false,
    },
    { texto: "Más de 4 toques en total", cumple: tramo.length > 4, obligatoria: false, detalle: `${tramo.length} toques` },
  ];

  const inicio = primero.indice;
  const segmentos: Segmento[] = [];
  let objetivo: Patron["objetivo"] = null;
  if (rompe) {
    const precioObjetivo = rompe.direccion === "arriba" ? techo + alto : piso - alto;
    objetivo = {
      precio: precioObjetivo,
      descripcion: `Altura del rango (${alto.toFixed(2)}) proyectada desde el borde ${rompe.direccion === "arriba" ? "superior" : "inferior"}`,
    };
    segmentos.push({
      desde: extremo(puntos, rompe.indice, precioObjetivo),
      hasta: extremo(puntos, puntos.length - 1, precioObjetivo),
      estilo: "objetivo",
      etiqueta: `Objetivo ${precioObjetivo.toFixed(2)}`,
    });
  }

  const marcadores = tramo.map((p, i) =>
    clavePivote(p, `${p.tipo === "maximo" ? "Techo" : "Piso"} ${tramo.slice(0, i + 1).filter((q) => q.tipo === p.tipo).length}`)
  );
  if (rompe) marcadores.push(clavePunto(puntos, rompe.indice, puntos[rompe.indice].cierre, "Ruptura"));
  return armarPatron(
    {
      familia: "rectangulo",
      nombre: "Rectángulo",
      sesgo: rompe ? (rompe.direccion === "arriba" ? "alcista" : "bajista") : "neutral",
      indiceInicio: inicio,
      indiceFin,
      puntos: marcadores,
      segmentos,
      zonas: [
        {
          desdeFecha: puntos[inicio].fecha,
          hastaFecha: puntos[indiceFin].fecha,
          minimo: piso,
          maximo: techo,
          etiqueta: `Rango ${piso.toFixed(0)}–${techo.toFixed(0)}`,
        },
      ],
      ruptura: rompe
        ? {
            fecha: puntos[rompe.indice].fecha,
            precio: puntos[rompe.indice].cierre,
            volumenRelativo: volRuptura,
            direccion: rompe.direccion,
          }
        : null,
      objetivo,
      reglas,
    },
    puntos,
    config,
    rompe ? [puntos[rompe.indice]] : []
  );
}
