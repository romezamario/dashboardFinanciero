import { calcularSerieTecnica, type PuntoTecnico, type Vela } from "../lib/tecnico";

/** Un tramo de la serie: va (en línea recta) hasta `hasta` en `barras` velas. */
export interface Tramo {
  hasta: number;
  barras: number;
  /** Volumen de la vela i del tramo (por defecto 1000). */
  volumen?: number | ((i: number, barras: number) => number);
}

const HOLGURA = 0.2;

/**
 * Serie sintética de velas diarias: parte de `inicio` y recorre los tramos en
 * línea recta, de modo que cada vértice es un máximo/mínimo claro (el pivote
 * cae justo en él). Máximo/mínimo de cada vela = cuerpo ± 0.2. Las fechas son
 * días corridos desde 2026-01-01 (a las pruebas solo les importa el orden).
 * Con `espejo` los precios se reflejan (p -> 2·eje - p) para probar la versión
 * invertida de un patrón con la misma serie.
 */
export function serieSintetica(inicio: number, tramos: Tramo[], espejo?: number): PuntoTecnico[] {
  const velas: Vela[] = [];
  let previo = inicio;
  let dia = 0;
  const poner = (p: number) => (espejo === undefined ? p : 2 * espejo - p);
  for (const tramo of tramos) {
    for (let i = 1; i <= tramo.barras; i++) {
      const cierre = previo + ((tramo.hasta - previo) * i) / tramo.barras;
      const apertura = i === 1 ? previo : previo + ((tramo.hasta - previo) * (i - 1)) / tramo.barras;
      const a = poner(apertura);
      const c = poner(cierre);
      const fecha = new Date(Date.UTC(2026, 0, 1 + dia)).toISOString().slice(0, 10);
      const volumen =
        typeof tramo.volumen === "function" ? tramo.volumen(i, tramo.barras) : (tramo.volumen ?? 1000);
      velas.push({
        fecha,
        apertura: a,
        cierre: c,
        maximo: Math.max(a, c) + HOLGURA,
        minimo: Math.min(a, c) - HOLGURA,
        volumen,
      });
      dia++;
    }
    previo = tramo.hasta;
  }
  return calcularSerieTecnica(velas);
}
