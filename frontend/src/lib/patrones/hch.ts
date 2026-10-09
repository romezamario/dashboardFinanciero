import type { PuntoTecnico } from "../tecnico";
import { CONFIG_DETECCION, type ConfigDeteccion } from "./config";
import { alternarPivotes, detectarPivotes } from "./pivotes";
import type { Patron, Pivote, Regla } from "./tipos";
import { armarPatron, clavePivote, clavePunto, extremo, media, sinEncimarse, volumenRelativo } from "./util";

/**
 * Hombro-cabeza-hombro (y su versión invertida) sobre 5 pivotes alternados
 * hombro, valle, cabeza, valle, hombro. Reglas (obligatorias):
 *  - la cabeza es más extrema que los dos hombros por al menos `ventajaCabeza`;
 *  - los hombros difieren como máximo `toleranciaHombros`;
 *  - la neckline pasa por los dos valles (los pivotes opuestos);
 *  - el patrón dura entre `minSesiones` y `maxSesiones`;
 *  - la ruptura de la neckline está CONFIRMADA por un cierre, como máximo
 *    `sesionesParaRuptura` sesiones después del hombro derecho.
 * De calidad: hombros simétricos (la mitad de la tolerancia), simetría en el
 * tiempo, menos volumen en el hombro derecho que en el izquierdo y volumen de
 * la ruptura alto. Objetivo: la altura de la cabeza sobre la neckline
 * proyectada desde el punto de ruptura.
 */
export function detectarHch(puntos: PuntoTecnico[], config: ConfigDeteccion = CONFIG_DETECCION): Patron[] {
  const pivotes = alternarPivotes(detectarPivotes(puntos, config.pivotes.ventana));
  const encontrados: Patron[] = [];
  for (let p = 0; p + 4 < pivotes.length; p++) {
    const patron = evaluar(puntos, pivotes.slice(p, p + 5), config);
    if (patron) encontrados.push(patron);
  }
  return sinEncimarse(encontrados);
}

function evaluar(puntos: PuntoTecnico[], seq: Pivote[], config: ConfigDeteccion): Patron | null {
  const c = config.hch;
  const [hi, v1, cab, v2, hd] = seq;
  // Techo: hombros y cabeza son máximos; invertido: mínimos.
  const techo = hi.tipo === "maximo";
  if (cab.tipo !== hi.tipo || hd.tipo !== hi.tipo) return null;
  const s = techo ? 1 : -1;

  // 1. Cabeza más extrema que ambos hombros.
  const ventajaIzq = (s * (cab.precio - hi.precio)) / hi.precio;
  const ventajaDer = (s * (cab.precio - hd.precio)) / hd.precio;
  if (ventajaIzq < c.ventajaCabeza || ventajaDer < c.ventajaCabeza) return null;
  // 2. Hombros a la par.
  const difHombros = Math.abs(hi.precio - hd.precio) / media([hi.precio, hd.precio]);
  if (difHombros > c.toleranciaHombros) return null;
  // 3. Neckline por los dos valles.
  const neck = (i: number) => v1.precio + ((v2.precio - v1.precio) * (i - v1.indice)) / (v2.indice - v1.indice);
  if (s * (cab.precio - neck(cab.indice)) <= 0) return null;
  // 4. Duración.
  const sesiones = hd.indice - hi.indice + 1;
  if (sesiones < c.minSesiones || sesiones > c.maxSesiones) return null;
  // 5. Ruptura confirmada por cierre.
  let ruptura = -1;
  for (let i = hd.indice + 1; i < puntos.length && i - hd.indice <= c.sesionesParaRuptura; i++) {
    if (s * (neck(i) - puntos[i].cierre) > 0) {
      ruptura = i;
      break;
    }
  }
  if (ruptura < 0) return null;

  const alturaCabeza = s * (cab.precio - neck(cab.indice));
  const precioObjetivo = neck(ruptura) - s * alturaCabeza;
  const volRuptura = volumenRelativo(puntos[ruptura]);
  const volumenEn = (i: number) => media(puntos.slice(Math.max(0, i - 2), i + 3).map((x) => x.volumen));
  const izq = cab.indice - hi.indice;
  const der = hd.indice - cab.indice;
  const asimetriaTiempo = Math.abs(izq - der) / (izq + der);
  const reglas: Regla[] = [
    {
      texto: "Cabeza más extrema que ambos hombros",
      cumple: true,
      obligatoria: true,
      detalle: `${(ventajaIzq * 100).toFixed(1)}% sobre el izq., ${(ventajaDer * 100).toFixed(1)}% sobre el der.`,
    },
    {
      texto: `Hombros a la par (≤ ${(c.toleranciaHombros * 100).toFixed(0)}%)`,
      cumple: true,
      obligatoria: true,
      detalle: `${(difHombros * 100).toFixed(1)}% de diferencia`,
    },
    { texto: "Neckline por los dos valles", cumple: true, obligatoria: true },
    { texto: `Duración ${c.minSesiones}–${c.maxSesiones} sesiones`, cumple: true, obligatoria: true, detalle: `${sesiones} sesiones` },
    {
      texto: "Ruptura de la neckline confirmada por cierre",
      cumple: true,
      obligatoria: true,
      detalle: `${puntos[ruptura].fecha}, cierre ${puntos[ruptura].cierre.toFixed(2)}`,
    },
    {
      texto: "Hombros muy simétricos (≤ la mitad de la tolerancia)",
      cumple: difHombros <= c.toleranciaHombros / 2,
      obligatoria: false,
    },
    {
      texto: "Simetría en el tiempo",
      cumple: asimetriaTiempo <= c.simetriaTiempoMax,
      obligatoria: false,
      detalle: `${(asimetriaTiempo * 100).toFixed(0)}% de asimetría`,
    },
    {
      texto: "Menos volumen en el hombro derecho que en el izquierdo",
      cumple: volumenEn(hd.indice) < volumenEn(hi.indice),
      obligatoria: false,
    },
    {
      texto: `Volumen de la ruptura ≥ ${config.volumen.umbralAlto}× el promedio`,
      cumple: volRuptura !== null && volRuptura >= config.volumen.umbralAlto,
      obligatoria: false,
      detalle: volRuptura !== null ? `${volRuptura.toFixed(2)}×` : "sin promedio",
    },
  ];

  const nombre = techo ? "Hombro-cabeza-hombro" : "Hombro-cabeza-hombro invertido";
  return armarPatron(
    {
      familia: "hch",
      nombre,
      sesgo: techo ? "bajista" : "alcista",
      indiceInicio: hi.indice,
      indiceFin: ruptura,
      puntos: [
        clavePivote(hi, "Hombro izq."),
        clavePivote(v1, "Valle 1"),
        clavePivote(cab, "Cabeza"),
        clavePivote(v2, "Valle 2"),
        clavePivote(hd, "Hombro der."),
        clavePunto(puntos, ruptura, puntos[ruptura].cierre, "Ruptura"),
      ],
      segmentos: [
        {
          desde: extremo(puntos, v1.indice, v1.precio),
          hasta: extremo(puntos, ruptura, neck(ruptura)),
          estilo: "neckline",
          etiqueta: "Neckline",
        },
        { desde: extremo(puntos, hi.indice, hi.precio), hasta: extremo(puntos, v1.indice, v1.precio), estilo: "guia" },
        { desde: extremo(puntos, v1.indice, v1.precio), hasta: extremo(puntos, cab.indice, cab.precio), estilo: "guia" },
        { desde: extremo(puntos, cab.indice, cab.precio), hasta: extremo(puntos, v2.indice, v2.precio), estilo: "guia" },
        { desde: extremo(puntos, v2.indice, v2.precio), hasta: extremo(puntos, hd.indice, hd.precio), estilo: "guia" },
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
        descripcion: `Altura de la cabeza sobre la neckline (${alturaCabeza.toFixed(2)}) proyectada desde la ruptura`,
      },
      reglas,
    },
    puntos,
    config,
    [puntos[ruptura]]
  );
}
