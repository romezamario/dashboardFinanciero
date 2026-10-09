import type { PuntoTecnico } from "../tecnico";
import { CONFIG_DETECCION, type ConfigDeteccion } from "./config";
import { alternarPivotes, detectarPivotes } from "./pivotes";
import type { Patron, Pivote, Regla } from "./tipos";
import { armarPatron, clavePivote, clavePunto, extremo, media, sinEncimarse, volumenRelativo } from "./util";

/**
 * Doble techo / doble piso sobre tres pivotes alternados (techo, valle,
 * techo; o piso, cima, piso). Reglas (obligatorias):
 *  - los dos extremos difieren como máximo `tolerancia` entre sí;
 *  - separados por `minSeparacion`–`maxSeparacion` sesiones;
 *  - el valle (o la cima) intermedio dista al menos `profundidadMin` de ellos;
 *  - ruptura CONFIRMADA: un cierre más allá del valle (doble techo) o de la
 *    cima (doble piso) como máximo `sesionesParaRuptura` sesiones después del
 *    segundo extremo.
 * De calidad: extremos casi iguales, menos volumen en el segundo, valle
 * profundo (el doble del mínimo) y volumen de la ruptura alto. Objetivo: la
 * distancia entre los extremos y el valle, proyectada desde el valle.
 */
export function detectarDobles(puntos: PuntoTecnico[], config: ConfigDeteccion = CONFIG_DETECCION): Patron[] {
  const pivotes = alternarPivotes(detectarPivotes(puntos, config.pivotes.ventana));
  const encontrados: Patron[] = [];
  for (let p = 0; p + 2 < pivotes.length; p++) {
    const patron = evaluar(puntos, pivotes[p], pivotes[p + 1], pivotes[p + 2], config);
    if (patron) encontrados.push(patron);
  }
  return sinEncimarse(encontrados);
}

function evaluar(puntos: PuntoTecnico[], a: Pivote, valle: Pivote, b: Pivote, config: ConfigDeteccion): Patron | null {
  const c = config.doble;
  const techo = a.tipo === "maximo";
  const s = techo ? 1 : -1;
  const dif = Math.abs(a.precio - b.precio) / media([a.precio, b.precio]);
  if (dif > c.tolerancia) return null;
  const separacion = b.indice - a.indice;
  if (separacion < c.minSeparacion || separacion > c.maxSeparacion) return null;
  const extremos = media([a.precio, b.precio]);
  const profundidad = (s * (extremos - valle.precio)) / extremos;
  if (profundidad < c.profundidadMin) return null;

  let ruptura = -1;
  for (let i = b.indice + 1; i < puntos.length && i - b.indice <= c.sesionesParaRuptura; i++) {
    if (s * (valle.precio - puntos[i].cierre) > 0) {
      ruptura = i;
      break;
    }
  }
  if (ruptura < 0) return null;

  const altura = s * (extremos - valle.precio);
  const precioObjetivo = valle.precio - s * altura;
  const volRuptura = volumenRelativo(puntos[ruptura]);
  const volumenEn = (i: number) => media(puntos.slice(Math.max(0, i - 2), i + 3).map((x) => x.volumen));
  const palabra = techo ? "techo" : "piso";
  const reglas: Regla[] = [
    {
      texto: `Dos ${palabra}s a la par (≤ ${(c.tolerancia * 100).toFixed(1)}%)`,
      cumple: true,
      obligatoria: true,
      detalle: `${(dif * 100).toFixed(2)}% de diferencia`,
    },
    {
      texto: `Separados ${c.minSeparacion}–${c.maxSeparacion} sesiones`,
      cumple: true,
      obligatoria: true,
      detalle: `${separacion} sesiones`,
    },
    {
      texto: `${techo ? "Valle" : "Cima"} intermedio de al menos ${(c.profundidadMin * 100).toFixed(0)}%`,
      cumple: true,
      obligatoria: true,
      detalle: `${(profundidad * 100).toFixed(1)}%`,
    },
    {
      texto: `Ruptura confirmada por cierre ${techo ? "bajo el valle" : "sobre la cima"}`,
      cumple: true,
      obligatoria: true,
      detalle: `${puntos[ruptura].fecha}, cierre ${puntos[ruptura].cierre.toFixed(2)}`,
    },
    { texto: `${techo ? "Techos" : "Pisos"} casi iguales (≤ la mitad de la tolerancia)`, cumple: dif <= c.tolerancia / 2, obligatoria: false },
    { texto: "Menos volumen en el segundo extremo", cumple: volumenEn(b.indice) < volumenEn(a.indice), obligatoria: false },
    { texto: `${techo ? "Valle" : "Cima"} profundo (el doble del mínimo)`, cumple: profundidad >= c.profundidadMin * 2, obligatoria: false },
    {
      texto: `Volumen de la ruptura ≥ ${config.volumen.umbralAlto}× el promedio`,
      cumple: volRuptura !== null && volRuptura >= config.volumen.umbralAlto,
      obligatoria: false,
      detalle: volRuptura !== null ? `${volRuptura.toFixed(2)}×` : "sin promedio",
    },
  ];

  return armarPatron(
    {
      familia: "doble",
      nombre: techo ? "Doble techo" : "Doble piso",
      sesgo: techo ? "bajista" : "alcista",
      indiceInicio: a.indice,
      indiceFin: ruptura,
      puntos: [
        clavePivote(a, `${techo ? "Techo" : "Piso"} 1`),
        clavePivote(valle, techo ? "Valle" : "Cima"),
        clavePivote(b, `${techo ? "Techo" : "Piso"} 2`),
        clavePunto(puntos, ruptura, puntos[ruptura].cierre, "Ruptura"),
      ],
      segmentos: [
        {
          desde: extremo(puntos, a.indice, valle.precio),
          hasta: extremo(puntos, ruptura, valle.precio),
          estilo: "neckline",
          etiqueta: techo ? "Soporte del valle" : "Resistencia de la cima",
        },
        { desde: extremo(puntos, a.indice, a.precio), hasta: extremo(puntos, valle.indice, valle.precio), estilo: "guia" },
        { desde: extremo(puntos, valle.indice, valle.precio), hasta: extremo(puntos, b.indice, b.precio), estilo: "guia" },
        {
          desde: extremo(puntos, ruptura, precioObjetivo),
          hasta: extremo(puntos, puntos.length - 1, precioObjetivo),
          estilo: "objetivo",
          etiqueta: `Objetivo ${precioObjetivo.toFixed(2)}`,
        },
      ],
      zonas: [],
      ruptura: {
        fecha: puntos[ruptura].fecha,
        precio: puntos[ruptura].cierre,
        volumenRelativo: volRuptura,
        direccion: techo ? "abajo" : "arriba",
      },
      objetivo: {
        precio: precioObjetivo,
        descripcion: `Distancia de los ${palabra}s al ${techo ? "valle" : "la cima"} (${altura.toFixed(2)}) proyectada desde ese nivel`,
      },
      reglas,
    },
    puntos,
    config,
    [puntos[ruptura]]
  );
}
