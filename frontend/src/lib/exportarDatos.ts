import type { Transaccion } from "./types";

// "Exportar mis datos" de Mi cuenta: todos los movimientos del usuario en un
// CSV que Excel abre bien (BOM para los acentos, fin de línea CRLF).

const COLUMNAS = [
  "fecha",
  "descripcion",
  "monto",
  "tipo",
  "categoria",
  "comercio",
  "evento",
  "cuenta",
  "banco",
  "tarjeta",
] as const;

/** Escapa un campo de CSV. Un texto que empieza con = + - @ se precede de
 * un apóstrofo para que Excel no lo ejecute como fórmula (una descripción del
 * banco podría empezar así). */
export function campoCsv(valor: string | number | null): string {
  if (valor === null) return "";
  if (typeof valor === "number") return String(valor);
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return /[",\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export function transaccionesACsv(transacciones: Transaccion[]): string {
  const ordenadas = [...transacciones].sort((a, b) =>
    a.fecha === b.fecha ? a.id.localeCompare(b.id) : a.fecha.localeCompare(b.fecha)
  );
  const filas = ordenadas.map((t) =>
    [
      t.fecha,
      t.descripcion,
      t.monto,
      t.tipo,
      t.categorias?.nombre ?? null,
      t.comercio,
      t.eventos?.nombre ?? null,
      t.documentos.cuentas.alias,
      t.documentos.cuentas.bancos.nombre,
      t.tarjeta,
    ]
      .map(campoCsv)
      .join(",")
  );
  return "﻿" + [COLUMNAS.join(","), ...filas].join("\r\n") + "\r\n";
}

export function nombreArchivoExportacion(hoy: string): string {
  return `ordenatulana-movimientos-${hoy}.csv`;
}

/** Descarga el texto como archivo (solo navegador). */
export function descargarTexto(nombre: string, contenido: string, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
