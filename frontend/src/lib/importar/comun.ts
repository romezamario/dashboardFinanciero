// Piezas que comparten los lectores de estados de cuenta del navegador
// (fase 2 de Ordena tu Lana). Son el equivalente en TypeScript de
// parsers/base.py + parsers/comun.py de la app de escritorio: el PDF se lee en
// el navegador del cliente y nunca sale de su computadora; solo se guardan los
// movimientos ya normalizados.

/** Una página = sus líneas de texto, ya sin espacios sobrantes y sin vacías. */
export type Paginas = readonly (readonly string[])[];

/** Una transacción tal como la imprime el PDF. `monto` SIEMPRE con signo:
 * negativo = cargo, positivo = abono (misma convención que RenglonCrudo en
 * parsers/base.py). `fecha` en DD/MM/AAAA. */
export interface RenglonCrudo {
  fecha: string;
  descripcion: string;
  monto: string;
  pagina: number;
  lineaCruda: string;
  tarjeta: string | null;
}

export interface Lectura {
  renglones: RenglonCrudo[];
  /** Avisos no fatales: filas que parecen movimientos pero no se pudieron leer. */
  advertencias: string[];
}

export interface InfoCuenta {
  alias: string | null;
  /** Solo los últimos 4 dígitos: el número completo nunca sale de la función
   * que lo encuentra (regla del repo). */
  ultimos4: string | null;
}

export interface Lector {
  /** Nombre del banco tal como se guarda en `bancos.nombre` (los mismos que
   * usa la app de escritorio, para que ambas compartan catálogo). */
  banco: string;
  /** Conservador: un falso positivo usaría el lector equivocado. */
  reconoce(paginas: Paginas): boolean;
  leer(paginas: Paginas): Lectura;
  cuenta(paginas: Paginas): InfoCuenta;
}

/** Mes abreviado en español → número (llaves en minúsculas). */
export const MESES: Readonly<Record<string, string>> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12",
};

export const PATRON_PAGO_MINIMO = /pago\s+m[ií]nimo/i;
export const PATRON_INVEX = /invex/i;

/** Páginas del inicio que miran la detección y la lectura de la cuenta. */
export const PAGINAS_INICIALES = 3;

export function textoInicial(paginas: Paginas, cuantas = PAGINAS_INICIALES): string {
  return paginas
    .slice(0, cuantas)
    .map((lineas) => lineas.join("\n"))
    .join("\n");
}

/** "1,234.56" → 123456 centavos (exacto, sin pasar por float). null si no es
 * un monto. Acepta signo "-" al inicio. */
export function aCentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/,/g, "");
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!m) return null;
  const centavos = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -centavos : centavos;
}

/** 123456 → "1234.56"; -5 → "-0.05". */
export function deCentavos(centavos: number): string {
  const signo = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "-$1,234.56" impreso como cargo: devuelve el monto con el signo que pide
 * RenglonCrudo (cargo negativo). */
export function montoConSigno(montoImpreso: string, esCargo: boolean): string | null {
  const centavos = aCentavos(montoImpreso);
  if (centavos === null) return null;
  return deCentavos(esCargo ? -Math.abs(centavos) : Math.abs(centavos));
}

/** "05-mar-2026" → "05/03/2026", o null. */
export function fechaDeGuiones(texto: string): string | null {
  const partes = texto.split("-");
  if (partes.length !== 3) return null;
  const [dia, mes, anio] = partes;
  const numero = MESES[mes.toLowerCase()];
  return numero ? `${dia}/${numero}/${anio}` : null;
}

/** Últimos 4 dígitos del run de dígitos más largo de `linea`. El número
 * completo no se guarda en ningún lado. */
export function ultimos4DeLinea(linea: string): string | null {
  const runs = linea.match(/\d+/g);
  if (!runs) return null;
  const masLargo = runs.reduce((a, b) => (b.length > a.length ? b : a));
  return masLargo.length >= 4 ? masLargo.slice(-4) : null;
}
