import { supabase } from "./supabase";

/** Fila de `gastos_correo`: un cargo reportado por un aviso de compra de
 * Banamex (correo). Tabla aparte de `transacciones` -- ver la migración
 * 20261004210000_add_gastos_correo.sql. */
export interface GastoCorreo {
  id: string;
  mensaje_id: string;
  fecha: string; // ISO date, día calendario en hora CDMX
  hora: string; // HH:MM, hora CDMX
  tarjeta: string; // terminación: "179", "203", "904"
  comercio: string;
  categoria: string;
  establecimiento: string | null;
  ciudad_cod: string | null;
  ciudad: string | null;
  monto: number;
  moneda: string;
}

/** Cuántos días hacia atrás se traen. PostgREST corta en 1,000 filas por
 * consulta y esto ronda decenas de avisos al día, así que 60 días cabe de
 * sobra sin paginar. */
export const DIAS_HISTORIAL = 60;

export async function obtenerGastosCorreo(): Promise<GastoCorreo[]> {
  const desde = new Date();
  desde.setDate(desde.getDate() - DIAS_HISTORIAL);
  const { data, error } = await supabase
    .from("gastos_correo")
    .select(
      "id, mensaje_id, fecha, hora, tarjeta, comercio, categoria, establecimiento, ciudad_cod, ciudad, monto, moneda"
    )
    .gte("fecha", desde.toISOString().slice(0, 10))
    .order("fecha", { ascending: false })
    .order("hora", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as GastoCorreo[];
}

// Nombres de las tarjetas por terminación. Cualquier otra se muestra como
// "Tarjeta NNN" y la tabla crea su columna sola.
export const NOMBRES_TARJETA: Record<string, string> = {
  "179": "Beyond adicional 179",
  "203": "Conquista adicional 203",
  "904": "Beyond 904 (titular)",
};
const ORDEN_TARJETAS = ["179", "203", "904"];

// Orden de categorías (las de reglas_categorizacion.json que más aparecen);
// las demás van después, alfabéticas.
const ORDEN_CATEGORIAS = [
  "Restaurantes",
  "Supermercado",
  "Compras",
  "Transporte",
  "Ocio",
  "Domiciliación",
  "Pago de servicios",
  "Salud",
  "Cuidado personal",
  "Vuelos",
  "Hospedaje",
];

export function nombreTarjeta(terminacion: string): string {
  return NOMBRES_TARJETA[terminacion] ?? `Tarjeta ${terminacion}`;
}

function rango(orden: string[], v: string): number {
  const i = orden.indexOf(v);
  return i < 0 ? orden.length : i;
}

function comparar(orden: string[]) {
  return (a: string, b: string) =>
    rango(orden, a) - rango(orden, b) || a.localeCompare(b, "es");
}

/** Sumas en centavos enteros: evita errores de coma flotante al sumar. */
export type Sumas = { porTarjeta: Record<string, number>; total: number };

export function sumar(gastos: GastoCorreo[], tarjetas: string[]): Sumas {
  const porTarjeta: Record<string, number> = {};
  for (const t of tarjetas) porTarjeta[t] = 0;
  let total = 0;
  for (const g of gastos) {
    const centavos = Math.round(g.monto * 100);
    porTarjeta[g.tarjeta] = (porTarjeta[g.tarjeta] ?? 0) + centavos;
    total += centavos;
  }
  return { porTarjeta, total };
}

/** Las sumas de UN gasto: su monto en la columna de su tarjeta, 0 en las demás. */
export function sumarUno(g: GastoCorreo, tarjetas: string[]): Sumas {
  const porTarjeta: Record<string, number> = {};
  for (const t of tarjetas) porTarjeta[t] = 0;
  const centavos = Math.round(g.monto * 100);
  porTarjeta[g.tarjeta] = centavos;
  return { porTarjeta, total: centavos };
}

export type FilaDetalle =
  | { tipo: "gasto"; gasto: GastoCorreo }
  | { tipo: "comercio"; comercio: string; sumas: Sumas }
  | { tipo: "categoria"; categoria: string; sumas: Sumas };

export interface DiaGastos {
  fecha: string;
  gastos: GastoCorreo[];
  tarjetas: string[];
  categorias: string[];
  total: Sumas;
  /** Una fila por categoría para la tabla de resumen. */
  resumen: { categoria: string; sumas: Sumas }[];
  /** Filas del detalle en orden de impresión, con subtotales por comercio
   * (solo si el comercio tiene más de una transacción) y por categoría. */
  detalle: FilaDetalle[];
}

export function agruparPorDia(gastos: GastoCorreo[]): DiaGastos[] {
  const porFecha = new Map<string, GastoCorreo[]>();
  for (const g of gastos) {
    const lista = porFecha.get(g.fecha);
    if (lista) lista.push(g);
    else porFecha.set(g.fecha, [g]);
  }
  return Array.from(porFecha.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([fecha, delDia]) => armarDia(fecha, delDia));
}

function armarDia(fecha: string, gastos: GastoCorreo[]): DiaGastos {
  const tarjetas = Array.from(new Set(gastos.map((g) => g.tarjeta))).sort(
    comparar(ORDEN_TARJETAS)
  );
  const categorias = Array.from(new Set(gastos.map((g) => g.categoria))).sort(
    comparar(ORDEN_CATEGORIAS)
  );
  const resumen = categorias.map((categoria) => ({
    categoria,
    sumas: sumar(
      gastos.filter((g) => g.categoria === categoria),
      tarjetas
    ),
  }));

  const detalle: FilaDetalle[] = [];
  for (const categoria of categorias) {
    const enCategoria = gastos.filter((g) => g.categoria === categoria);
    const comercios = Array.from(new Set(enCategoria.map((g) => g.comercio))).sort((a, b) =>
      a.localeCompare(b, "es")
    );
    for (const comercio of comercios) {
      const filas = enCategoria
        .filter((g) => g.comercio === comercio)
        .sort((a, b) => a.hora.localeCompare(b.hora));
      for (const gasto of filas) detalle.push({ tipo: "gasto", gasto });
      if (filas.length > 1) {
        detalle.push({ tipo: "comercio", comercio, sumas: sumar(filas, tarjetas) });
      }
    }
    detalle.push({ tipo: "categoria", categoria, sumas: sumar(enCategoria, tarjetas) });
  }

  return { fecha, gastos, tarjetas, categorias, total: sumar(gastos, tarjetas), resumen, detalle };
}

/** Semanas (domingo a sábado, como el calendario de es-MX) de un mes
 * "YYYY-MM": cada celda es la fecha ISO del día o null en los huecos antes
 * del día 1 y después del último. Todo en UTC para que la zona horaria del
 * navegador no corra ningún día. */
export function semanasDelMes(mes: string): (string | null)[][] {
  const [anio, m] = mes.split("-").map(Number);
  const huecosIniciales = new Date(Date.UTC(anio, m - 1, 1)).getUTCDay();
  const diasDelMes = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  const celdas: (string | null)[] = Array.from({ length: huecosIniciales }, () => null);
  for (let d = 1; d <= diasDelMes; d++) celdas.push(`${mes}-${String(d).padStart(2, "0")}`);
  while (celdas.length % 7 !== 0) celdas.push(null);
  const semanas: (string | null)[][] = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}

/** Dónde cae `valor` entre `minimo` (0) y `maximo` (1) en escala LOGARÍTMICA:
 * con una escala lineal un solo día de $15,000 dejaría todos los de $500 en el
 * mismo verde; el logaritmo reparte los colores sin perder el orden (más
 * gasto, siempre más cerca de 1). Todos los valores iguales (o uno solo) caen
 * en 0.5, sin nada con qué comparar. Los valores se acotan a >= 1 para que el
 * logaritmo exista. */
export function posicionEnEscala(valor: number, minimo: number, maximo: number): number {
  const lo = Math.log(Math.max(minimo, 1));
  const hi = Math.log(Math.max(maximo, 1));
  if (hi <= lo) return 0.5;
  const t = (Math.log(Math.max(valor, 1)) - lo) / (hi - lo);
  return Math.min(1, Math.max(0, t));
}

/** "2026-10" desplazado `delta` meses (negativo = hacia atrás). */
export function desplazarMes(mes: string, delta: number): string {
  const [anio, m] = mes.split("-").map(Number);
  const indice = anio * 12 + (m - 1) + delta;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, "0")}`;
}

/** "Octubre 2026" */
export function tituloMes(mes: string): string {
  const [anio, m] = mes.split("-").map(Number);
  const nombre = MESES[m - 1] ?? mes;
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}`;
}

const SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "Sábado 3 de octubre de 2026". Se calcula en UTC a mediodía para que la
 * zona horaria del navegador no corra el día. */
export function tituloDia(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return fecha;
  const dia = SEMANA[d.getUTCDay()];
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}
