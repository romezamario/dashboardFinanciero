// Banamex, tarjeta de crédito (Platino, Beyond, Conquista…). Port de
// parsers/banamex_tdc.py sin lo que solo aplica a las tarjetas del dueño (los
// tiers por últimos 4 dígitos) ni la decodificación de filas dibujadas como
// imagen (parsers/glifos.py): esas filas quedan como advertencia.
// - Renglón: "DD-mon-AAAA DD-mon-AAAA CONCEPTO ±$monto"; "+" = cargo, "-" = abono.
// - "PAGO INTERBANCARIO" ocupa varias líneas y cierra con "REFERENCIA: … ±$monto".
// - Formato 2024 (sin año ni signo; "Detalle de Operaciones"): el año sale
//   del periodo de la portada; un abono termina en " -".
// - El "SU ABONO...GRACIAS" se vuelve "PAGO TDC <TIER>" cuando se conoce el tier.

import {
  fechaDeGuiones,
  MESES,
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
const PATRON_TRANSACCION = new RegExp(
  String.raw`^(${FECHA})\s+${FECHA}\s+(.+?)\s+([+-])\s*\$\s*([\d,]+\.\d{2})[\s.]*$`
);
const PATRON_PREFIJO_FECHAS = new RegExp(String.raw`^${FECHA}\s+${FECHA}`);
const PATRON_PAGO_INTERBANCARIO_INICIO = new RegExp(
  String.raw`^(${FECHA})\s+${FECHA}\s+PAGO INTERBANCARIO\s*$`,
  "i"
);
const PATRON_PAGO_INTERBANCARIO_CIERRE = /REFERENCIA:\s*\S+\s+([+-])\s*\$\s*([\d,]+\.\d{2})[\s.]*$/i;
const PATRON_CONCEPTO = /^CONCEPTO:\s*(.+)$/i;
const PATRON_ABONO_CORTESIA = /^SU ABONO\.\.\./i;
const PATRON_SECCION_TARJETA = /^Tarjeta\s+(Titular|Adicional|Digital)\b/i;
const PATRON_LINEA_TARJETA = /n[uú]mero de tarjeta/i;
const PATRON_ALIAS = /^Estado de Cuenta\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s*$/;

const TIPOS_TARJETA: readonly [RegExp, string][] = [
  [/platino|platinum/i, "TDC Platino"],
  [/beyond/i, "TDC Beyond"],
  [/conquista|prestige/i, "TDC Conquista"],
];

const MESES_COMPLETOS: Readonly<Record<string, number>> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const PATRON_PERIODO_2024 =
  /\bDel\s+\d{1,2}\s+de\s+[a-záéíóú]+\s+al\s+\d{1,2}\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i;
const PATRON_FECHA_2024 = /^(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)\s+(\d{1,2})\s+(.+)$/;
const PATRON_MONTO_FINAL_2024 = /^(.*?)\s*(\d[\d,]*\.\d{2})(\s+-)?[\s.]*$/;
const PATRON_SEGUNDA_LINEA_2024 = /^(.*?)\s*(\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})(\s+-)?[\s.]*$/;
const PATRON_INICIO_OPERACIONES_2024 = /Detalle de Operaciones/i;
const PATRON_FIN_OPERACIONES_2024 = /Detalle de Pagos|EN PESOS MONEDA NACIONAL|RESUMEN DE SU/i;
const PATRON_TARJETA_2024 = /^Por su Tarjeta\s+(Titular|Adicional|Digital)\b/i;

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function tipoDeTarjeta(texto: string): string | null {
  for (const [patron, alias] of TIPOS_TARJETA) if (patron.test(texto)) return alias;
  return null;
}

function corteDelPeriodo(texto: string): { mes: number; anio: number } | null {
  const m = PATRON_PERIODO_2024.exec(texto);
  const mes = m ? MESES_COMPLETOS[m[1].toLowerCase()] : undefined;
  return m && mes ? { mes, anio: Number(m[2]) } : null;
}

export function leerBanamexTdc(paginas: Paginas): Lectura {
  const renglones: RenglonCrudo[] = [];
  const advertencias: string[] = [];
  const inicio = textoInicial(paginas);
  let tier = tipoDeTarjeta(inicio);
  const corte = corteDelPeriodo(inicio);

  let tarjeta: string | null = null;
  let interbancario: { pagina: number; fecha: string; concepto: string | null; crudas: string[] } | null = null;
  let enOperaciones2024 = false;
  let pendiente2024: { fecha: string; concepto: string; pagina: number; linea: string } | null = null;
  let tarjeta2024 = "Titular";

  const descripcionFinal = (descripcion: string) =>
    tier !== null && PATRON_ABONO_CORTESIA.test(descripcion)
      ? `PAGO TDC ${tier.replace(/^TDC /, "").toUpperCase()}`
      : descripcion;

  const agregar2024 = (fecha: string, concepto: string, monto: string, esAbono: boolean, pagina: number, crudas: string[]) => {
    const conSigno = montoConSigno(monto, !esAbono);
    if (conSigno === null) {
      advertencias.push(`Página ${pagina}: monto ilegible: ${crudas.join(" | ")}`);
      return;
    }
    let descripcion = concepto.trim();
    if (esAbono && /^PAGO INTERBANCARIO\b/i.test(descripcion)) descripcion = "PAGO RECIBIDO";
    renglones.push({
      fecha,
      descripcion: descripcionFinal(descripcion),
      monto: conSigno,
      pagina,
      lineaCruda: crudas.join(" | "),
      tarjeta: tarjeta2024,
    });
  };

  /** true si la línea es del formato 2024 y ya se procesó. */
  const procesar2024 = (linea: string, pagina: number): boolean => {
    if (pendiente2024 !== null) {
      const pendiente = pendiente2024;
      pendiente2024 = null;
      const segunda = PATRON_SEGUNDA_LINEA_2024.exec(linea);
      if (segunda) {
        agregar2024(pendiente.fecha, pendiente.concepto, segunda[3], Boolean(segunda[4]), pendiente.pagina, [
          pendiente.linea,
          linea,
        ]);
        return true;
      }
      advertencias.push(
        `Página ${pendiente.pagina}: movimiento sin monto (se esperaba la línea de moneda extranjera), revísalo: ${pendiente.linea}`
      );
    }
    if (PATRON_INICIO_OPERACIONES_2024.test(linea)) {
      enOperaciones2024 = true;
      return true;
    }
    if (!enOperaciones2024) return false;
    if (PATRON_FIN_OPERACIONES_2024.test(linea)) {
      enOperaciones2024 = false;
      return true;
    }
    const seccion = PATRON_TARJETA_2024.exec(linea);
    if (seccion) {
      tarjeta2024 = capitalizar(seccion[1]);
      return true;
    }
    const conFecha = PATRON_FECHA_2024.exec(linea);
    if (!conFecha) return false;
    if (corte === null) {
      advertencias.push(`Página ${pagina}: no se encontró el periodo ("Del … al … de AAAA") para saber el año de: ${linea}`);
      return true;
    }
    const mes = Number(MESES[conFecha[1].toLowerCase()]);
    const anio = mes <= corte.mes ? corte.anio : corte.anio - 1;
    const fecha = `${conFecha[2].padStart(2, "0")}/${String(mes).padStart(2, "0")}/${anio}`;
    const monto = PATRON_MONTO_FINAL_2024.exec(conFecha[3]);
    if (monto && monto[1]) agregar2024(fecha, monto[1], monto[2], Boolean(monto[3]), pagina, [linea]);
    else pendiente2024 = { fecha, concepto: conFecha[3], pagina, linea };
    return true;
  };

  const abandonarInterbancario = (motivo: string) => {
    if (!interbancario) return;
    advertencias.push(
      `Página ${interbancario.pagina}: bloque de PAGO INTERBANCARIO sin cerrar (${motivo}), revísalo: ${interbancario.crudas.join(" | ")}`
    );
    interbancario = null;
  };

  paginas.forEach((lineas, i) => {
    const pagina = i + 1;
    tier ??= tipoDeTarjeta(lineas.join("\n"));
    for (const linea of lineas) {
      if (procesar2024(linea, pagina)) continue;

      const seccion = PATRON_SECCION_TARJETA.exec(linea);
      if (seccion) {
        abandonarInterbancario("nueva sección de tarjeta");
        tarjeta = capitalizar(seccion[1]);
        continue;
      }

      if (interbancario) {
        const cierre = PATRON_PAGO_INTERBANCARIO_CIERRE.exec(linea);
        if (cierre) {
          const monto = montoConSigno(cierre[2], cierre[1] === "+");
          if (monto === null) {
            abandonarInterbancario("monto ilegible");
            continue;
          }
          interbancario.crudas.push(linea);
          renglones.push({
            fecha: interbancario.fecha,
            descripcion: interbancario.concepto ? `PAGO RECIBIDO ${interbancario.concepto}`.trim() : "PAGO RECIBIDO",
            monto,
            pagina: interbancario.pagina,
            lineaCruda: interbancario.crudas.join(" | "),
            tarjeta,
          });
          interbancario = null;
          continue;
        }
        if (PATRON_PAGO_INTERBANCARIO_INICIO.test(linea) || PATRON_TRANSACCION.test(linea)) {
          abandonarInterbancario("formato inesperado");
        } else {
          interbancario.crudas.push(linea);
          interbancario.concepto ??= PATRON_CONCEPTO.exec(linea)?.[1].trim() ?? null;
          continue;
        }
      }

      const inicioInterbancario = PATRON_PAGO_INTERBANCARIO_INICIO.exec(linea);
      if (inicioInterbancario) {
        const fecha = fechaDeGuiones(inicioInterbancario[1]);
        if (fecha) interbancario = { pagina, fecha, concepto: null, crudas: [linea] };
        continue;
      }

      const m = PATRON_TRANSACCION.exec(linea);
      if (!m) {
        if (PATRON_PREFIJO_FECHAS.test(linea))
          advertencias.push(
            `Página ${pagina}: fila con fecha pero sin concepto o monto legible (puede estar dibujada como imagen en el PDF), revísala: ${linea}`
          );
        continue;
      }
      const monto = montoConSigno(m[4], m[3] === "+");
      const fecha = fechaDeGuiones(m[1]);
      if (monto === null || fecha === null) continue;
      renglones.push({ fecha, descripcion: descripcionFinal(m[2].trim()), monto, pagina, lineaCruda: linea, tarjeta });
    }
  });

  abandonarInterbancario("fin del documento");
  if (pendiente2024 !== null) {
    const { pagina, linea } = pendiente2024;
    advertencias.push(`Página ${pagina}: movimiento sin monto al final del documento, revísalo: ${linea}`);
  }
  return { renglones, advertencias };
}

export const lectorBanamexTdc: Lector = {
  banco: "Banamex TDC",
  reconoce(paginas) {
    const texto = textoInicial(paginas, 2);
    return PATRON_PAGO_MINIMO.test(texto) && !PATRON_INVEX.test(texto);
  },
  leer: leerBanamexTdc,
  cuenta(paginas): InfoCuenta {
    const texto = textoInicial(paginas);
    let ultimos4: string | null = null;
    let respaldo: string | null = null;
    for (const linea of texto.split("\n")) {
      if (ultimos4 === null && PATRON_LINEA_TARJETA.test(linea)) ultimos4 = ultimos4DeLinea(linea);
      const alias = PATRON_ALIAS.exec(linea.trim());
      if (respaldo === null && alias) respaldo = `TDC ${alias[1]}`;
    }
    return { alias: tipoDeTarjeta(texto) ?? respaldo ?? "Banamex TDC", ultimos4 };
  },
};
