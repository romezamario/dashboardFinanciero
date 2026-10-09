import type { PuntoTecnico } from "../tecnico";
import { CONFIG_DETECCION, type ConfigDeteccion } from "./config";
import { alternarPivotes, detectarPivotes } from "./pivotes";
import type { Patron, Pivote, Regla, Segmento } from "./tipos";
import {
  ajusteParabolico,
  armarPatron,
  clavePivote,
  clavePunto,
  extremo,
  pendiente,
  sinEncimarse,
  volumenRelativo,
} from "./util";

/**
 * Taza con asa. Reglas (obligatorias):
 *  - taza entre dos máximos (los bordes) de `minSesionesTaza` a
 *    `maxSesionesTaza` sesiones, a la par (<= `toleranciaBordes`) y sin nada
 *    por encima de ellos dentro de la taza;
 *  - profundidad entre `profundidadMin` y `profundidadMax` (de los bordes al
 *    mínimo);
 *  - ajuste parabólico de los cierres de la taza que abre hacia arriba con
 *    R² >= `minR2` y con el fondo en el tramo central (`fondoCentro`);
 *  - asa tras el borde derecho: de `minSesionesAsa` a `maxSesionesAsa`
 *    sesiones, bajando al menos `asaRetrocesoMinPct` pero sin retroceder más
 *    de `maxRetrocesoAsa` de la subida de la taza.
 * De calidad: R² alto (>= 0.9), bordes casi iguales, volumen decreciente en el
 * asa, asa de retroceso moderado, ruptura del borde derecho confirmada por
 * cierre y con volumen alto. Objetivo: la profundidad de la taza proyectada
 * desde el borde derecho.
 */
export function detectarTazas(puntos: PuntoTecnico[], config: ConfigDeteccion = CONFIG_DETECCION): Patron[] {
  const c = config.taza;
  const maximos = alternarPivotes(detectarPivotes(puntos, config.pivotes.ventana)).filter((p) => p.tipo === "maximo");
  const encontrados: Patron[] = [];
  for (let i = 0; i < maximos.length; i++) {
    for (let j = i + 1; j < maximos.length; j++) {
      const largo = maximos[j].indice - maximos[i].indice;
      if (largo > c.maxSesionesTaza) break;
      if (largo < c.minSesionesTaza) continue;
      const patron = evaluar(puntos, maximos[i], maximos[j], config);
      if (patron) encontrados.push(patron);
    }
  }
  return sinEncimarse(encontrados);
}

function evaluar(puntos: PuntoTecnico[], izq: Pivote, der: Pivote, config: ConfigDeteccion): Patron | null {
  const c = config.taza;
  const n = puntos.length;
  const largo = der.indice - izq.indice;
  const borde = (izq.precio + der.precio) / 2;
  const difBordes = Math.abs(izq.precio - der.precio) / izq.precio;
  if (difBordes > c.toleranciaBordes) return null;

  // Fondo y bordes más altos del interior.
  let fondoIdx = izq.indice;
  let techoInterior = -Infinity;
  for (let k = izq.indice; k <= der.indice; k++) {
    if (puntos[k].minimo < puntos[fondoIdx].minimo) fondoIdx = k;
    if (k > izq.indice && k < der.indice) techoInterior = Math.max(techoInterior, puntos[k].maximo);
  }
  const fondo = puntos[fondoIdx].minimo;
  if (techoInterior > Math.max(izq.precio, der.precio) * (1 + c.toleranciaBordes)) return null;
  const profundidad = (borde - fondo) / borde;
  if (profundidad < c.profundidadMin || profundidad > c.profundidadMax) return null;

  const cierres = puntos.slice(izq.indice, der.indice + 1).map((p) => p.cierre);
  const ajuste = ajusteParabolico(cierres);
  if (!ajuste || ajuste.a <= 0 || ajuste.r2 < c.minR2) return null;
  const posFondo = ajuste.vertice / (cierres.length - 1);
  if (posFondo < c.fondoCentro[0] || posFondo > c.fondoCentro[1]) return null;

  // Base redondeada: en la mitad central, los cierres se mantienen cerca del fondo.
  const profundidadPrecio = borde - fondo;
  const cuartoDeTaza = Math.floor(largo / 4);
  const centrales = puntos.slice(izq.indice + cuartoDeTaza, der.indice - cuartoDeTaza + 1);
  const subeEnElCentro = (Math.max(...centrales.map((p) => p.cierre)) - fondo) / profundidadPrecio;
  if (subeEnElCentro > c.baseRedondaMax) return null;

  // Asa: desde el borde derecho hasta la ruptura (cierre sobre el borde) o
  // `maxSesionesAsa`.
  let ruptura = -1;
  let finAsa = der.indice;
  for (let k = der.indice + 1; k < n && k - der.indice <= c.maxSesionesAsa; k++) {
    if (puntos[k].cierre > der.precio) {
      ruptura = k;
      break;
    }
    finAsa = k;
  }
  const largoAsa = finAsa - der.indice;
  if (largoAsa < c.minSesionesAsa) return null;
  const tramoAsa = puntos.slice(der.indice + 1, finAsa + 1);
  const minAsa = Math.min(...tramoAsa.map((p) => p.minimo));
  const maxAsa = Math.max(...tramoAsa.map((p) => p.maximo));
  const subida = der.precio - fondo;
  const retroceso = (der.precio - minAsa) / subida;
  if (der.precio - minAsa < c.asaRetrocesoMinPct * der.precio) return null;
  if (retroceso > c.maxRetrocesoAsa || minAsa <= fondo) return null;
  if (maxAsa > der.precio * (1 + c.toleranciaBordes)) return null;

  const volRuptura = ruptura >= 0 ? volumenRelativo(puntos[ruptura]) : null;
  const volAsa = tramoAsa.map((p) => p.volumen);
  const precioObjetivo = der.precio + profundidadPrecio;
  const reglas: Regla[] = [
    {
      texto: `Taza de ${c.minSesionesTaza}–${c.maxSesionesTaza} sesiones con bordes a la par (≤ ${(c.toleranciaBordes * 100).toFixed(0)}%)`,
      cumple: true,
      obligatoria: true,
      detalle: `${largo} sesiones, bordes ${(difBordes * 100).toFixed(1)}% de diferencia`,
    },
    {
      texto: `Profundidad ${(c.profundidadMin * 100).toFixed(0)}–${(c.profundidadMax * 100).toFixed(0)}%`,
      cumple: true,
      obligatoria: true,
      detalle: `${(profundidad * 100).toFixed(1)}%`,
    },
    {
      texto: `Ajuste parabólico con R² ≥ ${c.minR2}`,
      cumple: true,
      obligatoria: true,
      detalle: `R² = ${ajuste.r2.toFixed(2)}`,
    },
    {
      texto: "Fondo en el tramo central de la taza",
      cumple: true,
      obligatoria: true,
      detalle: `al ${(posFondo * 100).toFixed(0)}% del ancho`,
    },
    {
      texto: `Base redondeada (la mitad central sube ≤ ${(c.baseRedondaMax * 100).toFixed(0)}% de la profundidad)`,
      cumple: true,
      obligatoria: true,
      detalle: `${(subeEnElCentro * 100).toFixed(0)}%`,
    },
    {
      texto: `Asa de ${c.minSesionesAsa}–${c.maxSesionesAsa} sesiones con retroceso ≤ ${(c.maxRetrocesoAsa * 100).toFixed(0)}% de la subida`,
      cumple: true,
      obligatoria: true,
      detalle: `${largoAsa} sesiones, retroceso ${(retroceso * 100).toFixed(0)}%`,
    },
    { texto: "R² ≥ 0.90 (taza muy redonda)", cumple: ajuste.r2 >= 0.9, obligatoria: false },
    { texto: "Bordes casi iguales (≤ la mitad de la tolerancia)", cumple: difBordes <= c.toleranciaBordes / 2, obligatoria: false },
    { texto: "Volumen decreciente en el asa", cumple: pendiente(volAsa) < 0, obligatoria: false },
    {
      texto: `Asa de retroceso moderado (≤ ${(c.asaRetrocesoIdeal * 100).toFixed(0)}%)`,
      cumple: retroceso <= c.asaRetrocesoIdeal,
      obligatoria: false,
    },
    {
      texto: "Ruptura del borde derecho confirmada por cierre",
      cumple: ruptura >= 0,
      obligatoria: false,
      detalle: ruptura >= 0 ? puntos[ruptura].fecha : "el asa sigue en formación",
    },
    {
      texto: `Volumen de la ruptura ≥ ${config.volumen.umbralAlto}× el promedio`,
      cumple: volRuptura !== null && volRuptura >= config.volumen.umbralAlto,
      obligatoria: false,
      detalle: volRuptura !== null ? `${volRuptura.toFixed(2)}×` : "sin ruptura",
    },
  ];

  // Curva del ajuste (cada pocas velas) y llaves bajo la taza y el asa.
  const paso = Math.max(1, Math.round(largo / 24));
  const segmentos: Segmento[] = [];
  for (let k = 0; k < cierres.length - 1; k += paso) {
    const k2 = Math.min(cierres.length - 1, k + paso);
    segmentos.push({
      desde: extremo(puntos, izq.indice + k, ajuste.valor(k)),
      hasta: extremo(puntos, izq.indice + k2, ajuste.valor(k2)),
      estilo: "ajuste",
    });
  }
  const llave = (desdeIdx: number, hastaIdx: number, nivel: number, etiqueta: string): Segmento[] => {
    const marca = profundidadPrecio * 0.06;
    return [
      { desde: extremo(puntos, desdeIdx, nivel + marca), hasta: extremo(puntos, desdeIdx, nivel), estilo: "llave" },
      { desde: extremo(puntos, desdeIdx, nivel), hasta: extremo(puntos, hastaIdx, nivel), estilo: "llave", etiqueta },
      { desde: extremo(puntos, hastaIdx, nivel), hasta: extremo(puntos, hastaIdx, nivel + marca), estilo: "llave" },
    ];
  };
  segmentos.push(...llave(izq.indice, der.indice, fondo - profundidadPrecio * 0.12, "Taza"));
  segmentos.push(...llave(der.indice, finAsa, minAsa - profundidadPrecio * 0.12, "Asa"));
  if (ruptura >= 0) {
    segmentos.push({
      desde: extremo(puntos, ruptura, precioObjetivo),
      hasta: extremo(puntos, n - 1, precioObjetivo),
      estilo: "objetivo",
      etiqueta: `Objetivo ${precioObjetivo.toFixed(2)}`,
    });
  }

  const marcadores = [
    clavePivote(izq, "Borde izq."),
    clavePunto(puntos, fondoIdx, fondo, "Fondo"),
    clavePivote(der, "Borde der."),
    clavePunto(puntos, finAsa, minAsa, "Fin del asa"),
  ];
  if (ruptura >= 0) marcadores.push(clavePunto(puntos, ruptura, puntos[ruptura].cierre, "Ruptura"));
  return armarPatron(
    {
      familia: "taza",
      nombre: "Taza con asa",
      sesgo: "alcista",
      indiceInicio: izq.indice,
      indiceFin: ruptura >= 0 ? ruptura : finAsa,
      puntos: marcadores,
      segmentos,
      zonas: [],
      ruptura:
        ruptura >= 0
          ? { fecha: puntos[ruptura].fecha, precio: puntos[ruptura].cierre, volumenRelativo: volRuptura, direccion: "arriba" }
          : null,
      objetivo: {
        precio: precioObjetivo,
        descripcion: `Profundidad de la taza (${profundidadPrecio.toFixed(2)}) proyectada desde el borde derecho`,
      },
      reglas,
    },
    puntos,
    config,
    ruptura >= 0 ? [puntos[ruptura]] : []
  );
}
