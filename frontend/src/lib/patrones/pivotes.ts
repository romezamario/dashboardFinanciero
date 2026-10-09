import type { Pivote, Vela } from "./tipos";

/**
 * Pivotes (fractales): una vela es pivote máximo si su máximo es mayor que el
 * de las `ventana` velas anteriores y no menor que el de las `ventana`
 * siguientes (en una meseta gana la primera vela); el pivote mínimo es lo
 * mismo con los mínimos. Los últimos `ventana` renglones no pueden ser pivote
 * todavía: les falta la confirmación de las velas que vienen después.
 */
export function detectarPivotes(velas: Vela[], ventana: number): Pivote[] {
  const salida: Pivote[] = [];
  for (let i = ventana; i < velas.length - ventana; i++) {
    let esMaximo = true;
    let esMinimo = true;
    for (let j = i - ventana; j <= i + ventana && (esMaximo || esMinimo); j++) {
      if (j === i) continue;
      if (j < i) {
        if (velas[j].maximo >= velas[i].maximo) esMaximo = false;
        if (velas[j].minimo <= velas[i].minimo) esMinimo = false;
      } else {
        if (velas[j].maximo > velas[i].maximo) esMaximo = false;
        if (velas[j].minimo < velas[i].minimo) esMinimo = false;
      }
    }
    if (esMaximo) {
      salida.push({ indice: i, fecha: velas[i].fecha, tipo: "maximo", precio: velas[i].maximo, vela: velas[i] });
    }
    if (esMinimo) {
      salida.push({ indice: i, fecha: velas[i].fecha, tipo: "minimo", precio: velas[i].minimo, vela: velas[i] });
    }
  }
  return salida;
}

/**
 * Deja los pivotes alternados (máximo, mínimo, máximo...): dos del mismo tipo
 * seguidos se reducen al más extremo. Los patrones de varios giros (hombro-
 * cabeza-hombro, murciélago, rectángulo) se leen sobre esta secuencia.
 */
export function alternarPivotes(pivotes: Pivote[]): Pivote[] {
  const salida: Pivote[] = [];
  for (const p of [...pivotes].sort((a, b) => a.indice - b.indice)) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.tipo === p.tipo) {
      const mejor = p.tipo === "maximo" ? p.precio > ultimo.precio : p.precio < ultimo.precio;
      if (mejor) salida[salida.length - 1] = p;
    } else {
      salida.push(p);
    }
  }
  return salida;
}
