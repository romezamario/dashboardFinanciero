// Lee el texto de un PDF en el navegador con pdf.js (se descarga solo al usar
// "Subir estado de cuenta": es su propio chunk). El archivo nunca sale de la
// computadora del cliente.

import type { Paginas } from "./comun";
import { agruparEnLineas, type FragmentoTexto } from "./lineas";

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

export async function leerPaginasPdf(datos: ArrayBuffer): Promise<Paginas> {
  const pdfjs = await import("pdfjs-dist");
  const { default: urlTrabajador } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = urlTrabajador;

  // pdf.js se queda con el buffer: se le pasa una copia.
  const tarea = pdfjs.getDocument({ data: new Uint8Array(datos.slice(0)) });
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
      paginas.push(agruparEnLineas(fragmentos));
      pagina.cleanup();
    }
    return paginas;
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
