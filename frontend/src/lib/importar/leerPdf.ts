// Lee el texto de un PDF en el navegador con pdf.js (se descarga solo al usar
// "Subir estado de cuenta": es su propio chunk). El archivo nunca sale de la
// computadora del cliente.

import type { Paginas } from "./comun";
import { huellasDeMascara, type DetallePagina, type LetraImagen } from "./glifos";
import { agruparEnLineasConPosicion, type FragmentoTexto } from "./lineas";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfLeido {
  paginas: Paginas;
  /** Posiciones de líneas y letras-imagen por página; solo si se pidieron. */
  detalles?: DetallePagina[];
}

type Matriz = [number, number, number, number, number, number];

const multiplicar = (m: Matriz, n: Matriz): Matriz => [
  n[0] * m[0] + n[1] * m[2],
  n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2],
  n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4],
  n[4] * m[1] + n[5] * m[3] + m[5],
];

interface MascaraPdfjs {
  data: Uint8Array | Uint8ClampedArray | null;
  width: number;
  height: number;
}

/** Las imágenes-máscara de 1 bit de la página (las "letras-imagen"), con su
 * caja en coordenadas de pdfplumber y las huellas de su bitmap. */
async function letrasDePagina(
  pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs"),
  pagina: PDFPageProxy,
  arriba: number
): Promise<LetraImagen[]> {
  const { OPS } = pdfjs;
  const lista = await pagina.getOperatorList();
  const huellas = new Map<string, Promise<string[] | null>>();
  const huellasDe = (id: string): Promise<string[] | null> => {
    let promesa = huellas.get(id);
    if (!promesa) {
      promesa = new Promise<MascaraPdfjs | null>((listo) => {
        // Por si el objeto nunca llega: mejor sin esa letra que colgados.
        const espera = setTimeout(() => listo(null), 2000);
        try {
          pagina.objs.get(id, (m: MascaraPdfjs) => {
            clearTimeout(espera);
            listo(m);
          });
        } catch {
          clearTimeout(espera);
          listo(null);
        }
      }).then((m) => (m?.data ? huellasDeMascara(m.width, m.height, new Uint8Array(m.data)) : null));
      huellas.set(id, promesa);
    }
    return promesa;
  };

  const pendientes: { matriz: Matriz; id: string }[] = [];
  const pila: Matriz[] = [];
  let ctm: Matriz = [1, 0, 0, 1, 0, 0];
  lista.fnArray.forEach((fn, i) => {
    const args = lista.argsArray[i];
    if (fn === OPS.save) pila.push(ctm);
    else if (fn === OPS.restore) ctm = pila.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiplicar(ctm, args as Matriz);
    else if (fn === OPS.paintFormXObjectBegin) {
      pila.push(ctm);
      if (Array.isArray(args[0]) && args[0].length === 6) ctm = multiplicar(ctm, args[0] as Matriz);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = pila.pop() ?? ctm;
    else if (fn === OPS.paintImageMaskXObject) {
      if (typeof args[0]?.data === "string") pendientes.push({ matriz: ctm, id: args[0].data });
    } else if (fn === OPS.paintImageMaskXObjectGroup) {
      for (const imagen of args[0] as { data: unknown; transform: Matriz }[])
        if (typeof imagen.data === "string") pendientes.push({ matriz: multiplicar(ctm, imagen.transform), id: imagen.data });
    } else if (fn === OPS.paintImageMaskXObjectRepeat) {
      const [imagen, a, b, c, d, posiciones] = args as [{ data: unknown }, number, number, number, number, ArrayLike<number>];
      if (typeof imagen?.data === "string")
        for (let k = 0; k + 1 < posiciones.length; k += 2)
          pendientes.push({ matriz: multiplicar(ctm, [a, b, c, d, posiciones[k], posiciones[k + 1]]), id: imagen.data });
    }
  });

  const letras: LetraImagen[] = [];
  for (const { matriz, id } of pendientes) {
    const h = await huellasDe(id);
    if (!h) continue;
    // La imagen ocupa el cuadrado unitario transformado por la matriz.
    const xs = [matriz[4], matriz[4] + matriz[0], matriz[4] + matriz[2], matriz[4] + matriz[0] + matriz[2]];
    const ys = [matriz[5], matriz[5] + matriz[1], matriz[5] + matriz[3], matriz[5] + matriz[1] + matriz[3]];
    letras.push({ x0: Math.min(...xs), top: arriba - Math.max(...ys), bottom: arriba - Math.min(...ys), huellas: h });
  }
  return letras;
}

export class PdfConContrasena extends Error {
  constructor() {
    super("El PDF tiene contraseña.");
  }
}

export class PdfIlegible extends Error {
  constructor() {
    super("No se pudo abrir el archivo como PDF.");
  }
}

/** Lee el texto de cada página. Si `quiereDetalle(paginas)` dice que sí (el
 * banco imprime filas como imágenes de letras), también las posiciones de
 * líneas y letras-imagen, para traducirlas con glifos.ts. */
export async function leerPaginasPdf(
  datos: ArrayBuffer,
  quiereDetalle: (paginas: Paginas) => boolean = () => false
): Promise<PdfLeido> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { default: urlTrabajador } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = urlTrabajador;

  // pdf.js se queda con el buffer: se le pasa una copia.
  // Sin OffscreenCanvas, pdf.js entrega las máscaras como bytes (no como
  // bitmap), que es lo que necesita la huella de las letras-imagen.
  const tarea = pdfjs.getDocument({ data: new Uint8Array(datos.slice(0)), isOffscreenCanvasSupported: false });
  let documento;
  try {
    documento = await tarea.promise;
  } catch (error) {
    await tarea.destroy();
    if (error instanceof Error && error.name === "PasswordException") throw new PdfConContrasena();
    throw new PdfIlegible();
  }

  try {
    const paginas: string[][] = [];
    const lineasConPosicion = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const pagina = await documento.getPage(n);
      const contenido = await pagina.getTextContent();
      const fragmentos: FragmentoTexto[] = [];
      for (const item of contenido.items) {
        if (!("str" in item)) continue;
        fragmentos.push({
          texto: item.str,
          x: item.transform[4],
          y: item.transform[5],
          ancho: item.width,
          alto: item.height,
        });
      }
      const [, abajo, , arriba] = pagina.view;
      const lineas = agruparEnLineasConPosicion(fragmentos, arriba);
      lineasConPosicion.push({ lineas, alto: arriba - abajo, arriba });
      paginas.push(lineas.map((l) => l.texto));
      pagina.cleanup();
    }
    if (!quiereDetalle(paginas)) return { paginas };

    const detalles: DetallePagina[] = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const pagina = await documento.getPage(n);
      const { lineas, alto, arriba } = lineasConPosicion[n - 1];
      let letras: LetraImagen[] = [];
      try {
        letras = await letrasDePagina(pdfjs, pagina, arriba);
      } catch {
        // Sin letras-imagen la página queda como el texto plano: el lector avisa.
      }
      detalles.push({ alto, lineas, letras });
      pagina.cleanup();
    }
    return { paginas, detalles };
  } finally {
    await tarea.destroy();
  }
}

/** sha256 en hexadecimal: el mismo `documentos.hash` que calcula la app de
 * escritorio, así un PDF subido por las dos vías es el mismo documento. */
export async function huellaArchivo(datos: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
