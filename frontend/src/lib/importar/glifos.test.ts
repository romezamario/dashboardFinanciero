import { describe, expect, it } from "vitest";
import { lectorBanamexTdc } from "./banamexTdc";
import { completarLineasConImagenes, huellasDeMascara, type LetraImagen, type TablaGlifos } from "./glifos";
import type { LineaPosicionada } from "./lineas";
import { procesarPaginas } from "./procesar";

// Mismo algoritmo que parsers/glifos.py. La comparación contra Python con un
// PDF real de letras-imagen (máscaras sin comprimir, Flate y /Decode [1 0]) se
// hizo con pdf.js en Chromium: mismas huellas y mismas líneas.

const AVANCE = 4.5;
const tabla: TablaGlifos = {
  ...Object.fromEntries(
    [..."ABCDEFGHIJLNOPRSTUa0123456789$,.-:"].map((c) => [`h-${c}`, [c, c === "." || c === "," ? 2.1 : AVANCE] as const])
  ),
  "0736a5928b2b39b3": ["I", 2.1], // el bitmap que es "I" o "l"
};

/** Letras-imagen de `texto` desde x, con la base de su caja en `bottom`. */
function letras(texto: string, x: number, bottom: number, huella = (c: string) => `h-${c}`): LetraImagen[] {
  const salida: LetraImagen[] = [];
  for (const c of texto) {
    if (c === " ") {
      x += 2.3;
      continue;
    }
    salida.push({ x0: x, top: bottom - 7, bottom, huellas: [huella(c), "otra"] });
    x += tabla[huella(c)]?.[1] ?? AVANCE;
  }
  return salida;
}

function linea(texto: string, x0: number, top: number): LineaPosicionada {
  let x = x0;
  const palabras = texto.split(" ").map((p) => {
    const palabra = { x0: x, x1: x + p.length * 4, texto: p };
    x += p.length * 4 + 2;
    return palabra;
  });
  return { texto, x0, top, bottom: top + 8, palabras };
}

const { esIncompleta, esEncabezado } = lectorBanamexTdc.imagenes!;

describe("filas dibujadas como imágenes de letras", () => {
  const lineas = [
    linea("01-ene-2025 02-ene-2025 TIENDA + $10.00", 50, 100),
    linea("03-ene-2025 03-ene-2025", 50, 112),
    linea("04-ene-2025 05-ene-2025", 50, 124),
    linea("CONCEPTO: RENTA", 60, 136),
    linea("06-ene-2025 06-ene-2025 OTRA + $20.00", 50, 160),
    linea("08-ene-2025 08-ene-2025", 50, 172),
  ];
  const pagina = {
    alto: 792,
    lineas,
    letras: [
      ...letras("TARJETA TITULAR: 4391", 50, 90),
      ...letras("SU ABONO...GRACIAS", 160, 120),
      ...letras("- $1,000.00", 400, 120),
      ...letras("PAGO INTERBANCARIO", 160, 132),
      ...letras("REFERENCIA: 123", 60, 156),
      ...letras("- $2,000.00", 400, 156),
      // "Q" no está en la tabla: esta fila no se completa.
      ...letras("QUESO", 160, 180),
    ],
  };

  it("completa los bloques, agrega el encabezado y deja lo desconocido", () => {
    expect(completarLineasConImagenes(pagina, esIncompleta, esEncabezado, tabla)).toEqual([
      "TARJETA TITULAR: 4391",
      "01-ene-2025 02-ene-2025 TIENDA + $10.00",
      "03-ene-2025 03-ene-2025 SU ABONO...GRACIAS - $1,000.00",
      "04-ene-2025 05-ene-2025 PAGO INTERBANCARIO",
      "CONCEPTO: RENTA",
      "REFERENCIA: 123 - $2,000.00",
      "06-ene-2025 06-ene-2025 OTRA + $20.00",
      "08-ene-2025 08-ene-2025",
    ]);
  });

  it("el lector usa las líneas completadas y sigue avisando de la fila ilegible", () => {
    const paginas = [["Estado de Cuenta Beyond", "Pago mínimo $500.00"], lineas.map((l) => l.texto)];
    const portada = { alto: 792, lineas: [linea("Estado de Cuenta Beyond", 50, 50), linea("Pago mínimo $500.00", 50, 62)], letras: [] };
    const conGlifos = procesarPaginas(paginas, undefined, [portada, pagina]);
    // Con la tabla real (GLIFOS) estas huellas inventadas no se reconocen.
    expect(conGlifos).toMatchObject({ reconocido: true });
    if (!conGlifos.reconocido) return;
    expect(conGlifos.movimientos.map((m) => m.descripcion)).toEqual(["TIENDA", "OTRA"]);
    expect(conGlifos.advertencias).toHaveLength(3);
  });

  it("'I' o 'l' según la letra anterior", () => {
    const iol = (c: string) => (c === "I" ? "0736a5928b2b39b3" : `h-${c}`);
    const pagina2 = {
      alto: 792,
      lineas: [linea("03-ene-2025 03-ene-2025", 50, 112)],
      letras: letras("TIaI", 160, 120, iol),
    };
    expect(completarLineasConImagenes(pagina2, esIncompleta, null, tabla)).toEqual(["03-ene-2025 03-ene-2025 TIal"]);
  });
});

describe("huella de la máscara", () => {
  it("es la misma que _huella() de Python, directa e invertida", async () => {
    // hashlib.sha1(b"7x10" + bytes(range(10))).hexdigest()[:16] y la invertida.
    expect(await huellasDeMascara(7, 10, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toEqual([
      "9f555cccfc639ace",
      "558fe883c9f40fae",
    ]);
  });
});
