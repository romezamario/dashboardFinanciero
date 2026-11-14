// Relaciones entre datos (Mario, 2026-11-14: "cómo cambia tu sueño los días
// de más estrés, o cómo cambia tu HRV con la hora en que te duermes"). Cada
// relación es una lista de pares (x, y) por día; se describe con la
// correlación de Pearson y comparando la mitad alta contra la mitad baja de x.
// Son asociaciones con pocos días, nunca causas.
import type { DiaEstres } from "./indicadores";
import { horarioSueno, minutosDormido, num, promedio, restarDias, type DiaSalud } from "./salud";
import { porcentajeEstres } from "./viajes";

export interface Par {
  fecha: string;
  x: number;
  y: number;
}

export type ClaveRelacion = "estres-sueno" | "estres-hrv" | "dormir-hrv" | "sueno-estres";

export interface DefRelacion {
  clave: ClaveRelacion;
  titulo: string;
  ejeX: string;
  ejeY: string;
  /** Unidad de y para las frases ("min", "ms", "%"). */
  unidadY: string;
  /** Cómo se llaman la mitad alta y la baja de x en la frase. */
  mitadAlta: string;
  mitadBaja: string;
}

export const RELACIONES: readonly DefRelacion[] = [
  {
    clave: "estres-sueno",
    titulo: "Estrés del día → sueño de esa noche",
    ejeX: "Estrés de día (% del tiempo en reposo)",
    ejeY: "Sueño de esa noche (min)",
    unidadY: "min de sueño",
    mitadAlta: "los días de más estrés",
    mitadBaja: "los de menos",
  },
  {
    clave: "estres-hrv",
    titulo: "Estrés del día → HRV de esa noche",
    ejeX: "Estrés de día (% del tiempo en reposo)",
    ejeY: "HRV de esa noche (ms)",
    unidadY: "ms de HRV",
    mitadAlta: "los días de más estrés",
    mitadBaja: "los de menos",
  },
  {
    clave: "dormir-hrv",
    titulo: "Hora de dormir → HRV de la noche",
    ejeX: "Hora en que te dormiste",
    ejeY: "HRV de la noche (ms)",
    unidadY: "ms de HRV",
    mitadAlta: "las noches que te dormiste más tarde",
    mitadBaja: "las que te dormiste más temprano",
  },
  {
    clave: "sueno-estres",
    titulo: "Sueño de la noche → estrés del día siguiente",
    ejeX: "Sueño de la noche (h)",
    ejeY: "Estrés de ese día (% en reposo)",
    unidadY: "puntos de % de estrés",
    mitadAlta: "los días después de dormir más",
    mitadBaja: "los de dormir menos",
  },
];

const sumarDias = (f: string, n: number) => restarDias(f, -n);

/** Pares de cada relación. Las fechas de `excluir` (p. ej. días de viaje) no
 * entran: un par se quita si cualquiera de sus dos días está excluido. */
export function paresDe(
  clave: ClaveRelacion,
  dias: readonly DiaSalud[],
  estres: readonly DiaEstres[],
  excluir: ReadonlySet<string> = new Set(),
): Par[] {
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  const pct = porcentajeEstres(estres);
  const pares: Par[] = [];
  const agregar = (fecha: string, otra: string, x: number | null | undefined, y: number | null | undefined) => {
    if (x == null || y == null || excluir.has(fecha) || excluir.has(otra)) return;
    pares.push({ fecha, x, y });
  };
  if (clave === "dormir-hrv") {
    for (const h of horarioSueno(dias)) agregar(h.fecha, h.fecha, h.rango[0], num(porFecha.get(h.fecha)?.noche?.hrv_ms));
    return pares;
  }
  for (const [fecha, p] of pct) {
    // La noche "de ese día" es la que termina al día siguiente.
    const noche = porFecha.get(sumarDias(fecha, 1))?.noche;
    if (clave === "estres-sueno") agregar(fecha, sumarDias(fecha, 1), p, minutosDormido(noche));
    if (clave === "estres-hrv") agregar(fecha, sumarDias(fecha, 1), p, num(noche?.hrv_ms));
    if (clave === "sueno-estres") agregar(fecha, fecha, minutosDormido(porFecha.get(fecha)?.noche), p);
  }
  return pares.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Pares mínimos para mostrar una relación (con menos no se dice nada). */
export const MINIMO_PARES = 5;
/** Con menos de estos pares la frase advierte que es poco para concluir. */
export const PARES_CONFIABLES = 14;

export type Fuerza = "sin-relacion" | "debil" | "moderada" | "fuerte";

export interface Relacion {
  n: number;
  r: number | null;
  fuerza: Fuerza;
  pendiente: number | null;
  intercepto: number | null;
  /** Promedio de y en la mitad con x más alto y en la mitad con x más bajo. */
  yMitadAlta: number | null;
  yMitadBaja: number | null;
}

export function pearson(pares: readonly Par[]): number | null {
  if (pares.length < 3) return null;
  const mx = promedio(pares.map((p) => p.x)) as number;
  const my = promedio(pares.map((p) => p.y)) as number;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pares) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

export function fuerzaDe(r: number | null): Fuerza {
  const a = Math.abs(r ?? 0);
  return a < 0.2 ? "sin-relacion" : a < 0.4 ? "debil" : a < 0.6 ? "moderada" : "fuerte";
}

export function relacion(pares: readonly Par[]): Relacion {
  const r = pearson(pares);
  let pendiente: number | null = null;
  let intercepto: number | null = null;
  if (pares.length >= 3) {
    const mx = promedio(pares.map((p) => p.x)) as number;
    const my = promedio(pares.map((p) => p.y)) as number;
    const sxx = pares.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    if (sxx > 0) {
      pendiente = pares.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
      intercepto = my - pendiente * mx;
    }
  }
  // Mitades por x (si hay número impar, el de en medio no cuenta). La
  // diferencia entre mitades se toma de la tendencia (pendiente × distancia
  // entre los x promedio de cada mitad): con muchos empates en x (días con 0%
  // de estrés) partir por orden daba una frase con signo contrario a r.
  const orden = [...pares].sort((a, b) => a.x - b.x);
  const mitad = Math.floor(orden.length / 2);
  const xBaja = promedio(orden.slice(0, mitad).map((p) => p.x));
  const xAlta = promedio(orden.slice(orden.length - mitad).map((p) => p.x));
  const enTendencia = (x: number | null) => (x === null || pendiente === null || intercepto === null ? null : intercepto + pendiente * x);
  return { n: pares.length, r, fuerza: fuerzaDe(r), pendiente, intercepto, yMitadAlta: enTendencia(xAlta), yMitadBaja: enTendencia(xBaja) };
}

const FUERZA_TEXTO: Record<Fuerza, string> = {
  "sin-relacion": "sin relación clara",
  debil: "relación débil",
  moderada: "relación moderada",
  fuerte: "relación fuerte",
};

/** Frase en español: "En los días de más estrés dormiste 34 min de sueño
 * menos que en los de menos (relación moderada, 12 días; todavía es poco)." */
export function fraseRelacion(def: DefRelacion, rel: Relacion): string {
  if (rel.n < MINIMO_PARES) return `Hacen falta al menos ${MINIMO_PARES} días con ambos datos (hay ${rel.n}).`;
  const poco = rel.n < PARES_CONFIABLES ? "; todavía son pocos días para concluir" : "";
  const cola = `(${FUERZA_TEXTO[rel.fuerza]}, r = ${(rel.r ?? 0).toFixed(2)}, ${rel.n} días${poco}).`;
  if (rel.yMitadAlta === null || rel.yMitadBaja === null) return cola;
  const d = rel.yMitadAlta - rel.yMitadBaja;
  const cantidad = Math.abs(d) < 0.5 ? "casi lo mismo" : `${Math.round(Math.abs(d))} ${def.unidadY} ${d > 0 ? "más" : "menos"}`;
  return `En ${def.mitadAlta} tuviste ${cantidad} que en ${def.mitadBaja} ${cola}`;
}
