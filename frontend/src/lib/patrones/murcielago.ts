import type { PuntoTecnico } from "../tecnico";
import { CONFIG_DETECCION, type ConfigDeteccion } from "./config";
import { alternarPivotes, detectarPivotes } from "./pivotes";
import type { Patron, Pivote, Regla } from "./tipos";
import { armarPatron, clavePivote, extremo } from "./util";

/** v dentro de [min, max] ampliado en `tolerancia` relativa (±3% por defecto). */
const dentro = (v: number, [min, max]: [number, number], tolerancia: number) =>
  v >= min * (1 - tolerancia) && v <= max * (1 + tolerancia);
const cerca = (v: number, objetivo: number, tolerancia: number) => Math.abs(v - objetivo) / objetivo <= tolerancia;

/**
 * Murciélago (patrón armónico) XABCD sobre 5 pivotes alternados. Reglas
 * (todas obligatorias, con tolerancia relativa `tolerancia` sobre cada
 * proporción):
 *  - B retrocede 0.382–0.5 del tramo XA;
 *  - D retrocede 0.886 de XA (medido desde A);
 *  - el tramo CD mide 1.618–2.618 veces BC;
 *  - C queda entre B y A (no supera a A).
 * D es el último pivote: queda confirmado por las velas que le siguen.
 * Alcista: X y B/D son mínimos; bajista: lo opuesto. Calidad: cada proporción
 * dentro de su rango EXACTO (sin tolerancia) y D a ±1% de 0.886. "Objetivo":
 * retroceso de 0.618 del tramo A→D desde D (referencia armónica habitual).
 */
export function detectarMurcielagos(puntos: PuntoTecnico[], config: ConfigDeteccion = CONFIG_DETECCION): Patron[] {
  const pivotes = alternarPivotes(detectarPivotes(puntos, config.pivotes.ventana));
  const encontrados: Patron[] = [];
  for (let p = 0; p + 4 < pivotes.length; p++) {
    const patron = evaluar(puntos, pivotes.slice(p, p + 5), config);
    if (patron) encontrados.push(patron);
  }
  // Los XABCD de pivotes consecutivos se pisan mucho: se queda el mejor de cada grupo.
  const orden = [...encontrados].sort((a, b) => b.puntaje - a.puntaje || b.indiceFin - a.indiceFin);
  const elegidos: Patron[] = [];
  for (const patron of orden) {
    if (!elegidos.some((e) => patron.indiceInicio <= e.indiceFin && e.indiceInicio <= patron.indiceFin)) {
      elegidos.push(patron);
    }
  }
  return elegidos.sort((a, b) => a.indiceInicio - b.indiceInicio);
}

function evaluar(puntos: PuntoTecnico[], seq: Pivote[], config: ConfigDeteccion): Patron | null {
  const c = config.murcielago;
  const [X, A, B, C, D] = seq;
  const alcista = X.tipo === "minimo";
  const xa = Math.abs(A.precio - X.precio);
  const bc = Math.abs(C.precio - B.precio);
  if (xa === 0 || bc === 0) return null;
  const ratioB = Math.abs(A.precio - B.precio) / xa;
  const ratioD = Math.abs(A.precio - D.precio) / xa;
  const ratioCd = Math.abs(C.precio - D.precio) / bc;
  // C entre B y A.
  const cEntre = alcista ? C.precio > B.precio && C.precio < A.precio : C.precio < B.precio && C.precio > A.precio;
  if (!cEntre) return null;
  if (!dentro(ratioB, c.b, c.tolerancia)) return null;
  if (!cerca(ratioD, c.d, c.tolerancia)) return null;
  if (!dentro(ratioCd, c.cd, c.tolerancia)) return null;

  const reglas: Regla[] = [
    {
      texto: `B retrocede ${c.b[0]}–${c.b[1]} de XA (±${(c.tolerancia * 100).toFixed(0)}%)`,
      cumple: true,
      obligatoria: true,
      detalle: `B = ${ratioB.toFixed(3)} de XA`,
    },
    {
      texto: `D retrocede ${c.d} de XA (±${(c.tolerancia * 100).toFixed(0)}%)`,
      cumple: true,
      obligatoria: true,
      detalle: `D = ${ratioD.toFixed(3)} de XA`,
    },
    {
      texto: `CD mide ${c.cd[0]}–${c.cd[1]} veces BC (±${(c.tolerancia * 100).toFixed(0)}%)`,
      cumple: true,
      obligatoria: true,
      detalle: `CD = ${ratioCd.toFixed(3)} × BC`,
    },
    { texto: "C queda entre B y A", cumple: true, obligatoria: true },
    { texto: "D confirmado como pivote por las velas siguientes", cumple: true, obligatoria: true },
    { texto: "B dentro de su rango exacto (sin tolerancia)", cumple: dentro(ratioB, c.b, 0), obligatoria: false },
    { texto: "D a ±1% de 0.886", cumple: cerca(ratioD, c.d, 0.01), obligatoria: false },
    { texto: "CD dentro de su rango exacto (sin tolerancia)", cumple: dentro(ratioCd, c.cd, 0), obligatoria: false },
  ];

  const precioObjetivo = D.precio + 0.618 * (A.precio - D.precio);
  const guia = (a: Pivote, b: Pivote) => ({
    desde: extremo(puntos, a.indice, a.precio),
    hasta: extremo(puntos, b.indice, b.precio),
    estilo: "guia" as const,
  });
  const ajuste = (a: Pivote, b: Pivote) => ({ ...guia(a, b), estilo: "ajuste" as const });
  return armarPatron(
    {
      familia: "murcielago",
      nombre: alcista ? "Murciélago alcista" : "Murciélago bajista",
      sesgo: alcista ? "alcista" : "bajista",
      indiceInicio: X.indice,
      indiceFin: D.indice,
      puntos: [
        clavePivote(X, "X"),
        clavePivote(A, "A"),
        clavePivote(B, `B ${ratioB.toFixed(2)}`),
        clavePivote(C, "C"),
        clavePivote(D, `D ${ratioD.toFixed(3)}`),
      ],
      segmentos: [
        guia(X, A),
        guia(A, B),
        guia(B, C),
        guia(C, D),
        ajuste(X, B),
        ajuste(A, C),
        ajuste(B, D),
        ajuste(X, D),
        {
          desde: extremo(puntos, D.indice, precioObjetivo),
          hasta: extremo(puntos, puntos.length - 1, precioObjetivo),
          estilo: "objetivo",
          etiqueta: `0.618 A→D ${precioObjetivo.toFixed(2)}`,
        },
      ],
      zonas: [],
      ruptura: null,
      objetivo: {
        precio: precioObjetivo,
        descripcion: "Retroceso de 0.618 del tramo A→D desde D (referencia armónica, no una ruptura confirmada)",
      },
      reglas,
    },
    puntos,
    config
  );
}
