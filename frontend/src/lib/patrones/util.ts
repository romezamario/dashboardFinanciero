import type { PuntoTecnico } from "../tecnico";
import type { Calidad, Extremo, Patron, Pivote, PuntoClave, Regla, Vela } from "./tipos";
import type { ConfigDeteccion } from "./config";

export const media = (valores: number[]): number =>
  valores.length === 0 ? 0 : valores.reduce((a, b) => a + b, 0) / valores.length;

/** Pendiente de la recta de mínimos cuadrados de `ys` contra 0..n-1. */
export function pendiente(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = media(ys);
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

export interface AjusteParabolico {
  /** Coeficiente cuadrático sobre x normalizado a 0..1 (> 0 = abre hacia arriba). */
  a: number;
  r2: number;
  /** Valor del ajuste en la posición i (0..n-1). */
  valor: (i: number) => number;
  /** Posición (0..n-1) del vértice, acotada al tramo. */
  vertice: number;
}

/** Ajuste y = a·t² + b·t + c por mínimos cuadrados (t = i/(n-1)) y su R². */
export function ajusteParabolico(ys: number[]): AjusteParabolico | null {
  const n = ys.length;
  if (n < 4) return null;
  const ts = ys.map((_, i) => i / (n - 1));
  // Ecuaciones normales 3×3 por eliminación gaussiana.
  const S = (k: number) => ts.reduce((s, t) => s + t ** k, 0);
  const T = (k: number) => ts.reduce((s, t, i) => s + t ** k * ys[i], 0);
  const m = [
    [S(4), S(3), S(2), T(2)],
    [S(3), S(2), S(1), T(1)],
    [S(2), S(1), S(0), T(0)],
  ];
  for (let c = 0; c < 3; c++) {
    let mayor = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[mayor][c])) mayor = r;
    [m[c], m[mayor]] = [m[mayor], m[c]];
    if (Math.abs(m[c][c]) < 1e-12) return null;
    for (let r = c + 1; r < 3; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  const coef = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = m[r][3];
    for (let k = r + 1; k < 3; k++) s -= m[r][k] * coef[k];
    coef[r] = s / m[r][r];
  }
  const [a, b, c] = coef;
  const valorT = (t: number) => a * t * t + b * t + c;
  const promedio = media(ys);
  const ssTot = ys.reduce((s, y) => s + (y - promedio) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - valorT(ts[i])) ** 2, 0);
  const verticeT = a === 0 ? 0.5 : Math.min(1, Math.max(0, -b / (2 * a)));
  return {
    a,
    r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
    valor: (i) => valorT(i / (n - 1)),
    vertice: verticeT * (n - 1),
  };
}

export function clavePivote(p: Pivote, etiqueta: string): PuntoClave {
  return { indice: p.indice, fecha: p.fecha, precio: p.precio, etiqueta, vela: p.vela };
}

export function clavePunto(puntos: Vela[], indice: number, precio: number, etiqueta: string): PuntoClave {
  return { indice, fecha: puntos[indice].fecha, precio, etiqueta, vela: puntos[indice] };
}

export const extremo = (puntos: Vela[], indice: number, precio: number): Extremo => ({
  fecha: puntos[indice].fecha,
  precio,
});

/** Volumen de la vela relativo a su promedio de 20 sesiones (null sin promedio). */
export function volumenRelativo(p: PuntoTecnico): number | null {
  return p.volumenPromedio20 && p.volumenPromedio20 > 0 ? p.volumen / p.volumenPromedio20 : null;
}

export function calidadDe(puntaje: number, config: ConfigDeteccion): Calidad {
  if (puntaje >= config.calidad.alta) return "alta";
  if (puntaje >= config.calidad.media) return "media";
  return "baja";
}

/** Fracción de reglas NO obligatorias cumplidas (1 si no hay ninguna). */
export function puntajeDe(reglas: Regla[]): number {
  const de_calidad = reglas.filter((r) => !r.obligatoria);
  if (de_calidad.length === 0) return 1;
  return de_calidad.filter((r) => r.cumple).length / de_calidad.length;
}

/** Velas distintas (por fecha) de una lista de puntos clave y extras. */
export function velasDistintas(puntos: PuntoClave[], extras: Vela[] = []): Vela[] {
  const porFecha = new Map<string, Vela>();
  for (const v of [...puntos.map((p) => p.vela), ...extras]) porFecha.set(v.fecha, v);
  return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

type DatosPatron = Omit<Patron, "id" | "puntaje" | "calidad" | "velasOrigen" | "fechaInicio" | "fechaFin"> & {
  fechaInicio?: string;
  fechaFin?: string;
};

/** Completa un patrón: id estable, puntaje, calidad y velas de origen. */
export function armarPatron(
  datos: DatosPatron,
  velas: Vela[],
  config: ConfigDeteccion,
  extrasOrigen: Vela[] = []
): Patron {
  const puntaje = puntajeDe(datos.reglas);
  const fechaInicio = datos.fechaInicio ?? velas[datos.indiceInicio].fecha;
  const fechaFin = datos.fechaFin ?? velas[datos.indiceFin].fecha;
  return {
    ...datos,
    id: `${datos.familia}-${datos.nombre}-${fechaInicio}-${fechaFin}`,
    fechaInicio,
    fechaFin,
    puntaje,
    calidad: calidadDe(puntaje, config),
    velasOrigen: velasDistintas(datos.puntos, extrasOrigen),
  };
}

/** Quita detecciones que se encimen en el tiempo, quedándose con las de mejor
 * puntaje (luego las más recientes). */
export function sinEncimarse(patrones: Patron[]): Patron[] {
  const orden = [...patrones].sort((a, b) => b.puntaje - a.puntaje || b.indiceFin - a.indiceFin);
  const elegidos: Patron[] = [];
  for (const p of orden) {
    if (!elegidos.some((e) => p.indiceInicio <= e.indiceFin && e.indiceInicio <= p.indiceFin)) elegidos.push(p);
  }
  return elegidos.sort((a, b) => a.indiceInicio - b.indiceInicio);
}
