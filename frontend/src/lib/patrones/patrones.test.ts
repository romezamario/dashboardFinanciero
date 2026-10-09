import { describe, expect, it } from "vitest";
import { serieSintetica } from "../../test/series";
import { calcularSerieTecnica } from "../tecnico";
import { CONFIG_DETECCION } from "./config";
import { detectarBanderas } from "./bandera";
import { detectarDobles } from "./dobles";
import { detectarHch } from "./hch";
import { detectarMurcielagos } from "./murcielago";
import { detectarPatrones } from "./index";
import { alternarPivotes, detectarPivotes } from "./pivotes";
import { detectarRectangulos } from "./rectangulo";
import { detectarTazas } from "./taza";
import { ajusteParabolico } from "./util";

describe("pivotes", () => {
  it("máximos y mínimos locales con su vela; los de las orillas no se confirman", () => {
    const p = serieSintetica(100, [
      { hasta: 110, barras: 8 },
      { hasta: 100, barras: 8 },
      { hasta: 108, barras: 8 },
    ]);
    const pivotes = detectarPivotes(p, 5);
    expect(pivotes.map((x) => [x.tipo, x.indice])).toEqual([
      ["maximo", 7],
      ["minimo", 15],
    ]);
    expect(pivotes[0].vela.fecha).toBe(p[7].fecha);
    expect(pivotes[0].precio).toBe(p[7].maximo);
  });

  it("alternar deja el más extremo cuando hay dos seguidos del mismo tipo", () => {
    const p = serieSintetica(100, [
      { hasta: 110, barras: 8 },
      { hasta: 105, barras: 6 }, // mínimo corto: no es pivote con ventana 5 en una pierna de 6
      { hasta: 112, barras: 8 },
      { hasta: 100, barras: 8 },
      { hasta: 104, barras: 8 },
    ]);
    const crudos = detectarPivotes(p, 3);
    const alternados = alternarPivotes(crudos);
    for (let i = 1; i < alternados.length; i++) expect(alternados[i].tipo).not.toBe(alternados[i - 1].tipo);
  });
});

describe("ajuste parabólico", () => {
  it("una parábola exacta da R² = 1 y abre hacia arriba", () => {
    const ys = Array.from({ length: 41 }, (_, i) => 80 + 20 * ((i - 20) / 20) ** 2);
    const ajuste = ajusteParabolico(ys)!;
    expect(ajuste.r2).toBeCloseTo(1, 6);
    expect(ajuste.a).toBeGreaterThan(0);
    expect(ajuste.vertice).toBeCloseTo(20, 3);
  });
  it("una recta no tiene curvatura útil", () => {
    const ajuste = ajusteParabolico(Array.from({ length: 30 }, (_, i) => 100 + i))!;
    expect(Math.abs(ajuste.a)).toBeLessThan(1e-6);
  });
});

/** Oscila entre 100 y 108 y rompe hacia arriba con mucho volumen. */
const rectangulo = () =>
  serieSintetica(104, [
    { hasta: 100, barras: 8 },
    { hasta: 108, barras: 8 },
    { hasta: 100, barras: 8 },
    { hasta: 108, barras: 8 },
    { hasta: 100, barras: 8 },
    { hasta: 108, barras: 8 },
    { hasta: 100, barras: 8 },
    { hasta: 112, barras: 8, volumen: 4000 },
  ]);

describe("rectángulo", () => {
  it("detecta el rango, la ruptura con su volumen y el objetivo medido", () => {
    const encontrados = detectarRectangulos(rectangulo());
    expect(encontrados).toHaveLength(1);
    const r = encontrados[0];
    expect(r.familia).toBe("rectangulo");
    expect(r.zonas[0].maximo).toBeCloseTo(108.2, 1);
    expect(r.zonas[0].minimo).toBeCloseTo(99.8, 1);
    expect(r.ruptura?.direccion).toBe("arriba");
    expect(r.ruptura?.volumenRelativo).toBeGreaterThan(1.5);
    // Objetivo = techo + altura del rango (108.2 + 8.4).
    expect(r.objetivo?.precio).toBeCloseTo(116.6, 1);
    expect(r.reglas.filter((x) => x.obligatoria).every((x) => x.cumple)).toBe(true);
    expect(r.calidad).not.toBe("baja");
    // Trazabilidad: cada punto clave trae su vela exacta.
    for (const punto of r.puntos) expect(punto.vela.fecha).toBe(punto.fecha);
    expect(r.velasOrigen.length).toBeGreaterThanOrEqual(r.puntos.length - 1);
  });

  it("no hay rectángulo si el rango es más ancho que el máximo permitido", () => {
    const ancho = serieSintetica(110, [
      { hasta: 100, barras: 8 },
      { hasta: 125, barras: 8 },
      { hasta: 100, barras: 8 },
      { hasta: 125, barras: 8 },
      { hasta: 100, barras: 8 },
      { hasta: 125, barras: 8 },
      { hasta: 100, barras: 8 },
      { hasta: 110, barras: 8 },
    ]);
    expect(detectarRectangulos(ancho)).toHaveLength(0);
  });

  it("no hay rectángulo si dura menos de las sesiones mínimas", () => {
    const corto = serieSintetica(104, [
      { hasta: 100, barras: 8 },
      { hasta: 108, barras: 6 },
      { hasta: 100, barras: 6 },
      { hasta: 108, barras: 6 },
      { hasta: 100, barras: 8 },
    ]);
    expect(detectarRectangulos(corto)).toHaveLength(0);
  });

  it("los parámetros se cambian en un solo lugar: con minSesiones menor sí detecta el corto", () => {
    const corto = serieSintetica(104, [
      { hasta: 100, barras: 8 },
      { hasta: 108, barras: 6 },
      { hasta: 100, barras: 6 },
      { hasta: 108, barras: 6 },
      { hasta: 100, barras: 8 },
      { hasta: 106, barras: 8 },
    ]);
    const laxa = { ...CONFIG_DETECCION, rectangulo: { ...CONFIG_DETECCION.rectangulo, minSesiones: 10 } };
    expect(detectarRectangulos(corto, laxa).length).toBeGreaterThan(0);
  });
});

/** Hombro-cabeza-hombro con neckline plana en 90 y ruptura a la baja. */
const hch = (espejo?: number) =>
  serieSintetica(
    88,
    [
      { hasta: 100, barras: 8, volumen: 3000 }, // hombro izquierdo con volumen alto
      { hasta: 90, barras: 8 },
      { hasta: 110, barras: 10, volumen: 2000 },
      { hasta: 90, barras: 10 },
      { hasta: 101, barras: 8, volumen: 700 }, // hombro derecho con menos volumen
      { hasta: 85, barras: 10, volumen: 3500 },
    ],
    espejo
  );

describe("hombro-cabeza-hombro", () => {
  it("detecta el de techo con neckline, ruptura por cierre y objetivo", () => {
    const encontrados = detectarHch(hch());
    expect(encontrados).toHaveLength(1);
    const h = encontrados[0];
    expect(h.nombre).toBe("Hombro-cabeza-hombro");
    expect(h.sesgo).toBe("bajista");
    expect(h.puntos.map((p) => p.etiqueta)).toEqual([
      "Hombro izq.",
      "Valle 1",
      "Cabeza",
      "Valle 2",
      "Hombro der.",
      "Ruptura",
    ]);
    expect(h.ruptura?.direccion).toBe("abajo");
    // Objetivo: neckline (89.8) menos la altura de la cabeza (110.2 - 89.8).
    expect(h.objetivo?.precio).toBeCloseTo(69.4, 0);
    expect(h.reglas.filter((r) => r.obligatoria).every((r) => r.cumple)).toBe(true);
    // Volumen menor en el hombro derecho: regla de calidad cumplida.
    expect(h.reglas.find((r) => r.texto.startsWith("Menos volumen"))?.cumple).toBe(true);
    expect(h.calidad).toBe("alta");
  });

  it("detecta la versión invertida con la misma serie reflejada", () => {
    const encontrados = detectarHch(hch(100));
    expect(encontrados).toHaveLength(1);
    expect(encontrados[0].nombre).toBe("Hombro-cabeza-hombro invertido");
    expect(encontrados[0].sesgo).toBe("alcista");
    expect(encontrados[0].ruptura?.direccion).toBe("arriba");
    expect(encontrados[0].objetivo?.precio).toBeCloseTo(130.6, 0);
  });

  it("sin cierre bajo la neckline no se dibuja (la ruptura debe estar confirmada)", () => {
    const sinRuptura = serieSintetica(88, [
      { hasta: 100, barras: 8 },
      { hasta: 90, barras: 8 },
      { hasta: 110, barras: 10 },
      { hasta: 90, barras: 10 },
      { hasta: 101, barras: 8 },
      { hasta: 94, barras: 10 },
    ]);
    expect(detectarHch(sinRuptura)).toHaveLength(0);
  });

  it("hombros fuera de tolerancia o cabeza que no domina: no hay patrón", () => {
    const desiguales = serieSintetica(88, [
      { hasta: 100, barras: 8 },
      { hasta: 90, barras: 8 },
      { hasta: 110, barras: 10 },
      { hasta: 90, barras: 10 },
      { hasta: 108, barras: 8 }, // hombro derecho casi tan alto como la cabeza
      { hasta: 85, barras: 10 },
    ]);
    expect(detectarHch(desiguales)).toHaveLength(0);
  });
});

/** Mástil de 100 a 120, bandera que baja a 114 con volumen decreciente y ruptura. */
const bandera = (pisoBandera = 114, espejo?: number) =>
  serieSintetica(
    100,
    [
      { hasta: 100.5, barras: 8 },
      { hasta: 120, barras: 8, volumen: 3000 },
      { hasta: pisoBandera, barras: 10, volumen: (i, n) => 1500 - (1000 * i) / n },
      { hasta: 127, barras: 7, volumen: (i) => (i >= 4 ? 3500 : 500) },
    ],
    espejo
  );

describe("bandera", () => {
  it("detecta la alcista con su mástil, retroceso < 50%, ruptura y objetivo", () => {
    const encontrados = detectarBanderas(bandera());
    const alcista = encontrados.filter((b) => b.nombre === "Bandera alcista");
    expect(alcista).toHaveLength(1);
    const b = alcista[0];
    expect(b.reglas.filter((r) => r.obligatoria).every((r) => r.cumple)).toBe(true);
    expect(b.ruptura?.direccion).toBe("arriba");
    // Objetivo: extremo del mástil (120.2) + su altura (~20.4).
    expect(b.objetivo?.precio).toBeGreaterThan(139);
    expect(b.objetivo?.precio).toBeLessThan(142);
    expect(b.zonas[0].etiqueta).toBe("Bandera");
    expect(b.reglas.find((r) => r.texto.startsWith("Retroceso <"))?.detalle).toMatch(/%$/);
  });

  it("la bajista es la alcista reflejada", () => {
    const encontrados = detectarBanderas(bandera(114, 100));
    expect(encontrados.filter((b) => b.nombre === "Bandera bajista")).toHaveLength(1);
    expect(encontrados.find((b) => b.nombre === "Bandera bajista")?.ruptura?.direccion).toBe("abajo");
  });

  it("un retroceso de más de la mitad del mástil no es bandera", () => {
    expect(detectarBanderas(bandera(106)).filter((b) => b.nombre === "Bandera alcista")).toHaveLength(0);
  });

  it("con volumen creciente en la bandera no se dibuja", () => {
    const creciente = serieSintetica(100, [
      { hasta: 100.5, barras: 8 },
      { hasta: 120, barras: 8, volumen: 3000 },
      { hasta: 114, barras: 10, volumen: (i, n) => 500 + (1000 * i) / n },
      { hasta: 127, barras: 7, volumen: 3500 },
    ]);
    expect(detectarBanderas(creciente)).toHaveLength(0);
  });

  it("un mástil de menos del mínimo no cuenta", () => {
    const chico = serieSintetica(100, [
      { hasta: 100.5, barras: 8 },
      { hasta: 105, barras: 8, volumen: 3000 },
      { hasta: 103, barras: 10, volumen: (i, n) => 1500 - (1000 * i) / n },
      { hasta: 108, barras: 7 },
    ]);
    expect(detectarBanderas(chico)).toHaveLength(0);
  });
});

/** Taza parabólica de 100 a 80 y de vuelta a 100 (60 velas), asa y ruptura. */
function taza() {
  const velasTaza = Array.from({ length: 60 }, (_, i) => 80 + 20 * ((i + 1 - 30) / 30) ** 2);
  const tramos = [
    { hasta: 100, barras: 8 },
    ...velasTaza.map((hasta) => ({ hasta, barras: 1 })),
    { hasta: 95, barras: 8, volumen: (i: number, n: number) => 1200 - (600 * i) / n },
    { hasta: 97, barras: 6, volumen: 500 },
    { hasta: 106, barras: 6, volumen: 3000 },
  ];
  return serieSintetica(90, tramos);
}

describe("taza con asa", () => {
  it("detecta taza (R², profundidad, fondo central) y asa con retroceso ≤ 50%", () => {
    const encontrados = detectarTazas(taza());
    expect(encontrados.length).toBeGreaterThan(0);
    const t = encontrados[0];
    expect(t.nombre).toBe("Taza con asa");
    expect(t.reglas.filter((r) => r.obligatoria).every((r) => r.cumple)).toBe(true);
    expect(t.reglas.find((r) => r.texto.startsWith("Ajuste parabólico"))?.detalle).toMatch(/R² = (0\.9|1\.0)/);
    expect(t.segmentos.some((s) => s.estilo === "llave" && s.etiqueta === "Taza")).toBe(true);
    expect(t.segmentos.some((s) => s.estilo === "llave" && s.etiqueta === "Asa")).toBe(true);
    expect(t.ruptura?.direccion).toBe("arriba");
    expect(t.objetivo?.precio).toBeGreaterThan(110);
  });

  it("un fondo en V (sin forma de taza) no pasa el R² mínimo", () => {
    const v = serieSintetica(90, [
      { hasta: 100, barras: 8 },
      { hasta: 80, barras: 30 },
      { hasta: 100, barras: 30 },
      { hasta: 95, barras: 8 },
      { hasta: 97, barras: 6 },
      { hasta: 106, barras: 6 },
    ]);
    expect(detectarTazas(v)).toHaveLength(0);
  });

  it("una taza demasiado profunda (> 35%) no es taza con asa", () => {
    const honda = Array.from({ length: 60 }, (_, i) => 55 + 45 * ((i + 1 - 30) / 30) ** 2);
    const serie = serieSintetica(90, [
      { hasta: 100, barras: 8 },
      ...honda.map((hasta) => ({ hasta, barras: 1 })),
      { hasta: 95, barras: 8 },
      { hasta: 97, barras: 6 },
    ]);
    expect(detectarTazas(serie)).toHaveLength(0);
  });
});

/** XABCD de un murciélago alcista: B 0.46, D 0.89 de XA y CD = 2.4 × BC. */
const murcielago = (dFinal = 102.28, espejo?: number) =>
  serieSintetica(
    108,
    [
      { hasta: 100, barras: 8 }, // X
      { hasta: 120, barras: 8 }, // A
      { hasta: 111, barras: 8 }, // B
      { hasta: 117, barras: 8 }, // C
      { hasta: dFinal, barras: 8 }, // D
      { hasta: 108, barras: 8 },
    ],
    espejo
  );

describe("murciélago", () => {
  it("valida B, D y CD con las proporciones de Fibonacci", () => {
    const encontrados = detectarMurcielagos(murcielago());
    expect(encontrados).toHaveLength(1);
    const m = encontrados[0];
    expect(m.nombre).toBe("Murciélago alcista");
    expect(m.puntos.map((p) => p.etiqueta[0])).toEqual(["X", "A", "B", "C", "D"]);
    expect(m.reglas.filter((r) => r.obligatoria).every((r) => r.cumple)).toBe(true);
    expect(m.reglas.find((r) => r.texto.startsWith("D retrocede"))?.detalle).toMatch(/0\.8[89]/);
  });

  it("la versión bajista es la alcista reflejada", () => {
    const encontrados = detectarMurcielagos(murcielago(102.28, 100));
    expect(encontrados.map((m) => m.nombre)).toEqual(["Murciélago bajista"]);
  });

  it("con D fuera de 0.886 ± 3% no hay patrón", () => {
    expect(detectarMurcielagos(murcielago(97))).toHaveLength(0);
    expect(detectarMurcielagos(murcielago(105))).toHaveLength(0);
  });

  it("la tolerancia es configurable (con 0 la proporción debe ser exacta)", () => {
    const estricta = { ...CONFIG_DETECCION, murcielago: { ...CONFIG_DETECCION.murcielago, tolerancia: 0 } };
    // 0.888 de XA queda fuera de 0.886 con tolerancia cero.
    expect(detectarMurcielagos(murcielago(), estricta)).toHaveLength(0);
  });
});

describe("doble techo / doble piso", () => {
  const doble = (espejo?: number) =>
    serieSintetica(
      90,
      [
        { hasta: 100, barras: 8 },
        { hasta: 92, barras: 8 },
        { hasta: 100.5, barras: 8 },
        { hasta: 88, barras: 10, volumen: 3000 },
      ],
      espejo
    );

  it("doble techo con ruptura del valle y objetivo", () => {
    const encontrados = detectarDobles(doble());
    expect(encontrados).toHaveLength(1);
    expect(encontrados[0].nombre).toBe("Doble techo");
    expect(encontrados[0].sesgo).toBe("bajista");
    // Valle 91.8; techos ~100.45 -> objetivo ~83.15.
    expect(encontrados[0].objetivo?.precio).toBeCloseTo(83.15, 0);
  });

  it("doble piso (la serie reflejada)", () => {
    const encontrados = detectarDobles(doble(100));
    expect(encontrados.map((d) => d.nombre)).toEqual(["Doble piso"]);
    expect(encontrados[0].sesgo).toBe("alcista");
  });

  it("sin cierre más allá del valle no se confirma", () => {
    const sin = serieSintetica(90, [
      { hasta: 100, barras: 8 },
      { hasta: 92, barras: 8 },
      { hasta: 100.5, barras: 8 },
      { hasta: 95, barras: 10 },
    ]);
    expect(detectarDobles(sin)).toHaveLength(0);
  });

  it("techos que difieren más de la tolerancia no forman doble techo", () => {
    const desiguales = serieSintetica(90, [
      { hasta: 100, barras: 8 },
      { hasta: 92, barras: 8 },
      { hasta: 104, barras: 8 },
      { hasta: 88, barras: 10 },
    ]);
    expect(detectarDobles(desiguales)).toHaveLength(0);
  });
});

describe("una serie sin patrones", () => {
  it("una tendencia limpia no dispara ningún detector", () => {
    const recta = serieSintetica(100, [{ hasta: 160, barras: 260 }]);
    const todo = detectarPatrones(recta);
    for (const familia of Object.values(todo)) expect(familia).toHaveLength(0);
  });

  it("una serie plana tampoco", () => {
    const plana = serieSintetica(100, [{ hasta: 100, barras: 200 }]);
    for (const familia of Object.values(detectarPatrones(plana))) expect(familia).toHaveLength(0);
  });
});

describe("detectarPatrones", () => {
  it("agrupa por familia y deja las más recientes", () => {
    const todo = detectarPatrones(rectangulo());
    expect(todo.rectangulo).toHaveLength(1);
    expect(todo.hch).toHaveLength(0);
  });

  it("maximoPorFamilia limita cuántas se devuelven", () => {
    const una = { ...CONFIG_DETECCION, maximoPorFamilia: 1 };
    const dosDobles = serieSintetica(90, [
      { hasta: 100, barras: 8 },
      { hasta: 92, barras: 8 },
      { hasta: 100.5, barras: 8 },
      { hasta: 88, barras: 10 },
      { hasta: 100, barras: 10 },
      { hasta: 92, barras: 8 },
      { hasta: 100.4, barras: 8 },
      { hasta: 86, barras: 10 },
    ]);
    expect(detectarDobles(dosDobles).length).toBeGreaterThan(1);
    expect(detectarPatrones(dosDobles, una).doble).toHaveLength(1);
  });
});

describe("volumen en la serie técnica", () => {
  it("marca los días con volumen > 1.5× su promedio y el color usa el cierre previo", () => {
    const velas = Array.from({ length: 30 }, (_, i) => ({
      fecha: `2026-02-${String(i + 1).padStart(2, "0")}`,
      apertura: 100,
      // Cierra por debajo de la apertura (100) pero 0.1 por encima del cierre previo.
      cierre: 97 + i * 0.1,
      maximo: 101,
      minimo: 98,
      volumen: i === 29 ? 2600 : 1000,
    }));
    const serie = calcularSerieTecnica(velas);
    const ultimo = serie[29];
    expect(ultimo.volumenAlto).toBe(true);
    expect(ultimo.volumenRelativo).toBeGreaterThan(1.5);
    expect(serie[28].volumenAlto).toBe(false);
    // Vela roja (cierre < apertura) pero cierre >= cierre previo: cuenta como alcista.
    expect(ultimo.cierre).toBeLessThan(ultimo.apertura);
    expect(ultimo.alzaDelDia).toBe(true);
    // El umbral sale de la configuración.
    const exigente = calcularSerieTecnica(velas, {
      ...CONFIG_DETECCION,
      volumen: { ...CONFIG_DETECCION.volumen, umbralAlto: 3 },
    });
    expect(exigente[29].volumenAlto).toBe(false);
  });
});
