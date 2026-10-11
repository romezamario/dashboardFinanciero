// Invex, tarjeta de crédito. Port de parsers/invex_tdc.py. Dos formatos del
// mismo producto, probados por línea:
// - V1 "DD-Mon-AAAA DD-Mon-AAAA CONCEPTO CIUDAD ±$MONTO": "+" = cargo.
// - V2 "DD/MM/AAAA CONCEPTO $MONTO[ CR]": un "CR" al final = abono; sin
//   marca = cargo (fácil de invertir: revisar con cuidado si se toca).
// Secciones de tarjeta: V1 imprime el rol ("Tarjeta Titular …"); V2 solo
// "************1234 NOMBRE", así que la tarjeta queda como sus últimos 4.

import {
  fechaDeGuiones,
  montoConSigno,
  PATRON_INVEX,
  PATRON_PAGO_MINIMO,
  textoInicial,
  ultimos4DeLinea,
  type InfoCuenta,
  type Lector,
  type Lectura,
  type Paginas,
  type RenglonCrudo,
} from "./comun";

const FECHA = String.raw`\d{2}-[a-zA-Z]{3}-\d{4}`;
const PATRON_V1 = new RegExp(String.raw`^(${FECHA})\s+${FECHA}\s+(.+?)\s+([+-])\s*\$\s*([\d,]+\.\d{2})[\s.]*$`);
const PATRON_PREFIJO_V1 = new RegExp(String.raw`^${FECHA}\s+${FECHA}`);
const PATRON_V2 = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+\$([\d,]+\.\d{2})(\s+CR)?[\s.]*$/i;
const PATRON_PREFIJO_V2 = /^\d{2}\/\d{2}\/\d{4}\s/;
const PATRON_TARJETA_ENMASCARADA = /\*{4,}(\d{4})\b/;
const PATRON_SECCION_CON_ROL = /^Tarjeta\s+(Titular|Adicional|Digital)\b/i;
const PATRON_LINEA_TARJETA = /no\.?\s*tarjeta|n[uú]mero de la tarjeta/i;

export function leerInvexTdc(paginas: Paginas): Lectura {
  const renglones: RenglonCrudo[] = [];
  const advertencias: string[] = [];
  let tarjeta: string | null = null;

  paginas.forEach((lineas, i) => {
    const pagina = i + 1;
    for (const linea of lineas) {
      const rol = PATRON_SECCION_CON_ROL.exec(linea);
      if (rol) {
        tarjeta = rol[1].charAt(0).toUpperCase() + rol[1].slice(1).toLowerCase();
        continue;
      }
      // Anclado al inicio: un movimiento nunca empieza con asteriscos.
      const seccion = linea.match(new RegExp("^" + PATRON_TARJETA_ENMASCARADA.source));
      if (seccion) {
        tarjeta = seccion[1];
        continue;
      }

      const v1 = PATRON_V1.exec(linea);
      if (v1) {
        const monto = montoConSigno(v1[4], v1[3] === "+");
        const fecha = fechaDeGuiones(v1[1]);
        if (monto !== null && fecha !== null)
          renglones.push({ fecha, descripcion: v1[2].trim(), monto, pagina, lineaCruda: linea, tarjeta });
        continue;
      }

      const v2 = PATRON_V2.exec(linea);
      if (v2) {
        const monto = montoConSigno(v2[3], !v2[4]);
        if (monto !== null)
          renglones.push({ fecha: v2[1], descripcion: v2[2].trim(), monto, pagina, lineaCruda: linea, tarjeta });
        continue;
      }

      if (PATRON_PREFIJO_V1.test(linea) || PATRON_PREFIJO_V2.test(linea))
        advertencias.push(
          `Página ${pagina}: fila con fecha pero sin concepto o monto legible (puede estar dibujada como imagen en el PDF), revísala: ${linea}`
        );
    }
  });
  return { renglones, advertencias };
}

export const lectorInvexTdc: Lector = {
  banco: "Invex TDC",
  reconoce(paginas) {
    const texto = textoInicial(paginas, 2);
    return PATRON_INVEX.test(texto) && PATRON_PAGO_MINIMO.test(texto);
  },
  leer: leerInvexTdc,
  cuenta(paginas): InfoCuenta {
    let ultimos4: string | null = null;
    for (const linea of textoInicial(paginas).split("\n")) {
      ultimos4 ??= PATRON_TARJETA_ENMASCARADA.exec(linea)?.[1] ?? null;
      if (ultimos4 === null && PATRON_LINEA_TARJETA.test(linea)) ultimos4 = ultimos4DeLinea(linea);
    }
    return { alias: ultimos4 ? "Invex TDC" : null, ultimos4 };
  },
};
