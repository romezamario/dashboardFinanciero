// Banamex, cuenta de cheques (ej. Priority). Port de parsers/banamex.py; la
// historia de cada regla está en ese archivo y en docs/decisiones/parsers.md.
// Lo esencial:
// - cada movimiento empieza con "DD MES", sigue con N líneas de concepto y
//   cierra con una línea que termina en dos montos: "<…> <monto> <saldo>";
// - el signo sale del DELTA DE SALDO (saldo nuevo − anterior), nunca del texto
//   del concepto ("CREDITO NOMINA … A SU TC" es un cargo);
// - el año no viene en cada renglón: se toma de la portada ("Fecha de corte"
//   o "Periodo"), con el año actual como respaldo.

import {
  aCentavos,
  deCentavos,
  MESES,
  textoInicial,
  type InfoCuenta,
  type Lector,
  type Lectura,
  type Paginas,
  type RenglonCrudo,
} from "./comun";

const PATRON_FECHA_PREFIJO = /^(\d{2})\s+([A-ZÁÉÍÓÚ]{3})\s+(.*)$/;
const PATRON_DOS_MONTOS = /^(.*?)\s*(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})[\s.]*$/;
const PATRON_ALIAS = /Cuenta\s+[A-Za-zÁÉÍÓÚáéíóú]+(?:\s+[A-Za-zÁÉÍÓÚáéíóú]+)?$/;
const PATRON_CUENTA_CHEQUES = /cuenta de cheques\s+(\d+)/i;
const PATRON_LINEA_CON_ANIO = /FECHA DE CORTE|PERIODO|PER[ÍI]ODO/i;

export function detectarAnio(portada: readonly string[]): string | null {
  for (const linea of portada) {
    if (PATRON_LINEA_CON_ANIO.test(linea)) {
      const anio = /\d{4}/.exec(linea);
      if (anio) return anio[0];
    }
  }
  return null;
}

export function leerBanamex(paginas: Paginas, anioRespaldo = String(new Date().getFullYear())): Lectura {
  const anio = detectarAnio(paginas[0] ?? []) ?? anioRespaldo;
  const renglones: RenglonCrudo[] = [];
  const advertencias: string[] = [];

  let saldo: number | null = null;
  let fecha: string | null = null;
  let paginaBloque: number | null = null;
  let concepto: string[] = [];
  let crudas: string[] = [];

  const advertir = (motivo: string) => {
    const texto = concepto.join(" ").trim() || "(sin concepto)";
    advertencias.push(`Página ${paginaBloque ?? "?"}: ${motivo}: ${texto.slice(0, 120)}`);
  };
  const reiniciar = () => {
    fecha = null;
    paginaBloque = null;
    concepto = [];
    crudas = [];
  };

  paginas.forEach((lineas, i) => {
    const pagina = i + 1;
    for (const linea of lineas) {
      let resto = linea;
      const conFecha = PATRON_FECHA_PREFIJO.exec(linea);
      if (conFecha) {
        if (fecha !== null && concepto.length > 0)
          advertir("un movimiento empezó pero nunca cerró con monto y saldo (se descartó)");
        const [, dia, mes, despues] = conFecha;
        fecha = `${dia}/${MESES[mes.toLowerCase()] ?? "01"}/${anio}`;
        paginaBloque = pagina;
        concepto = [];
        crudas = [];
        resto = despues;
      }
      crudas.push(linea);

      if (resto.trim().toUpperCase().startsWith("SALDO ANTERIOR")) {
        const ultimo = resto.trim().split(/\s+/).pop() ?? "";
        const valor = aCentavos(ultimo);
        if (valor !== null) saldo = valor;
        reiniciar();
        continue;
      }

      const montos = PATRON_DOS_MONTOS.exec(resto);
      if (montos) {
        const textoResto = montos[1].trim();
        if (textoResto) concepto.push(textoResto);
        const saldoNuevo = aCentavos(montos[3]);
        if (saldoNuevo === null) continue;
        if (saldo === null && fecha !== null)
          advertir("movimiento antes del SALDO ANTERIOR, sin saldo previo para calcular su monto (se descartó)");
        if (fecha !== null && saldo !== null && saldoNuevo !== saldo) {
          renglones.push({
            fecha,
            descripcion: concepto.join(" ").trim(),
            monto: deCentavos(saldoNuevo - saldo),
            pagina: paginaBloque ?? 1,
            lineaCruda: crudas.join(" | "),
            tarjeta: null,
          });
        }
        saldo = saldoNuevo;
        reiniciar();
        continue;
      }

      if (resto.trim()) concepto.push(resto.trim());
    }
  });

  if (fecha !== null && concepto.length > 0)
    advertir("el documento terminó con un movimiento sin cerrar (se descartó)");
  return { renglones, advertencias };
}

export const lectorBanamex: Lector = {
  banco: "Banamex",
  reconoce(paginas) {
    // "BANAMEX" solo no alcanza (también lo dicen las TDC): el encabezado de
    // la tabla de movimientos es exclusivo de la cuenta de cheques.
    return paginas.slice(0, 3).some((lineas) => {
      const texto = lineas.join("\n").toUpperCase();
      return texto.includes("BANAMEX") && texto.includes("FECHA CONCEPTO RETIROS");
    });
  },
  leer: (paginas) => leerBanamex(paginas),
  cuenta(paginas): InfoCuenta {
    let alias: string | null = null;
    let ultimos4: string | null = null;
    for (const linea of textoInicial(paginas, 1).split("\n")) {
      alias ??= PATRON_ALIAS.exec(linea.trim())?.[0] ?? null;
      if (ultimos4 === null) {
        const numero = PATRON_CUENTA_CHEQUES.exec(linea)?.[1];
        if (numero && numero.length >= 4) ultimos4 = numero.slice(-4);
      }
    }
    return { alias, ultimos4 };
  },
};
