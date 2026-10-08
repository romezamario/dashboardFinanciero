import { categoriaDe, cuentaDe, eventoDe } from "./queries";
import { mesesHasta, nombreMes, nombrePeriodo, resumenPorMes, type Periodo } from "./indicadores";
import type { Transaccion } from "./types";
import { moneda, monedaConCentavos as monedaExacta, porcentaje, decimal } from "./formato";

// Alertas automáticas del Resumen: lo relevante del periodo, en frases.
// Todo sale de las transacciones ya sincronizadas (nada nuevo en Supabase
// ni en los parsers). Quien llama pasa las transacciones SIN categorías
// ocultas ni eventos descartados, pero SIN filtros por clic: igual que los
// indicadores de salud, las alertas describen tus finanzas completas del
// periodo (los filtros por clic son para explorar, no para esconder un
// posible cargo duplicado).

export type TipoAlerta =
  | "duplicado"
  | "suscripcion-nueva"
  | "cambio-precio"
  | "cargo-inusual"
  | "tasa-ahorro";

/** "revisar" = algo que conviene verificar o que empeoró; "favorable" =
 * mejoró; "info" = neutral (un hecho nuevo, ni bueno ni malo). */
export type TonoAlerta = "revisar" | "favorable" | "info";

export interface Alerta {
  /** Estable entre renders (clave de React). */
  id: string;
  tipo: TipoAlerta;
  tono: TonoAlerta;
  titulo: string;
  detalle: string;
  /** Para ordenar: pesos en juego (mayor primero dentro del mismo tono). */
  importancia: number;
  /** Filtro por clic que lleva al detalle (la tabla de transacciones). */
  filtro?: { campo: "comercio" | "categoria"; valor: string };
}

const formatoDia = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });

const mesDe = (t: Transaccion) => t.fecha.slice(0, 7);

/** "2026-08-14" → "14 ago" (sin pasar por UTC, que puede correr el día). */
function nombreDia(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return formatoDia.format(new Date(anio, mes - 1, dia)).replace(".", "");
}

// Las líneas de eco de Invex V2 se extraen como cargos de $0 (ver CLAUDE.md):
// no son compras y no deben disparar ninguna alerta.
const esCompra = (t: Transaccion) => t.tipo === "cargo" && t.monto > 0;

const ORDEN_TONO: Record<TonoAlerta, number> = { revisar: 0, favorable: 1, info: 2 };

/** Todas las alertas del periodo: primero la de tasa de ahorro (el resumen
 * del periodo, si cambió), luego las demás de la más a la menos urgente. */
export function calcularAlertas(transacciones: Transaccion[], periodo: Periodo): Alerta[] {
  const resto = [
    ...detectarDuplicados(transacciones, periodo),
    ...detectarCambiosDePrecio(transacciones, periodo),
    ...detectarSuscripcionesNuevas(transacciones, periodo),
    ...detectarCargosInusuales(transacciones, periodo),
  ].sort((a, b) => ORDEN_TONO[a.tono] - ORDEN_TONO[b.tono] || b.importancia - a.importancia);
  return [...alertaTasaDeAhorro(transacciones, periodo), ...resto];
}

/**
 * Posibles cargos duplicados: misma cuenta, mismo comercio (o, sin comercio,
 * misma descripción), mismo monto y mismo día. Es "posible" a propósito:
 * hay repeticiones legítimas (dos casetas Televia iguales el mismo día, ver
 * CLAUDE.md) -- la alerta pide revisar, no afirma un error.
 */
export function detectarDuplicados(transacciones: Transaccion[], periodo: Periodo): Alerta[] {
  const meses = new Set(periodo.meses);
  const grupos = new Map<string, Transaccion[]>();
  for (const t of transacciones) {
    if (!esCompra(t) || !meses.has(mesDe(t))) continue;
    const clave = [cuentaDe(t), t.comercio ?? t.descripcion.trim().toUpperCase(), t.monto, t.fecha].join("|");
    grupos.set(clave, [...(grupos.get(clave) ?? []), t]);
  }
  return Array.from(grupos.entries())
    .filter(([, grupo]) => grupo.length > 1)
    .map(([clave, grupo]) => {
      const t = grupo[0];
      const quien = t.comercio ?? t.descripcion;
      return {
        id: `duplicado:${clave}`,
        tipo: "duplicado" as const,
        tono: "revisar" as const,
        titulo: `Posible cargo duplicado: ${quien}`,
        detalle: `${grupo.length} cargos de ${monedaExacta.format(t.monto)} el ${nombreDia(t.fecha)} en ${cuentaDe(t)}. Si no hiciste ${grupo.length === 2 ? "las dos compras" : "todas esas compras"}, reclámalo al banco.`,
        importancia: t.monto * (grupo.length - 1),
        filtro: t.comercio ? { campo: "comercio" as const, valor: t.comercio } : undefined,
      };
    });
}

// Un cobro de "monto fijo" (suscripción) tolera esta diferencia relativa
// entre cargos -- redondeos, IVA de centavos, tipo de cambio de un servicio
// en dólares que apenas se mueve.
const TOLERANCIA_MONTO_FIJO = 0.02;
// Y un cambio de precio cuenta a partir de aquí (y de $10, para no avisar
// por variaciones de centavos en servicios cobrados en dólares).
const CAMBIO_PRECIO_MINIMO = 0.03;
const CAMBIO_PRECIO_MINIMO_PESOS = 10;
// Más de esto ya no es "subió el precio" sino otra compra (un vuelo de
// $14,000 en la aerolínea donde antes pagabas $2,500): eso lo cubre
// "Cargo inusual", no esta alerta.
const CAMBIO_PRECIO_MAXIMO = 0.5;

const parecidos = (a: number, b: number) => Math.abs(a - b) <= TOLERANCIA_MONTO_FIJO * Math.max(a, b);

/**
 * Cargos de cada comercio en meses con UN SOLO cargo de ese comercio, en
 * orden de fecha. Una suscripción cobra una vez al mes; un comercio con
 * varios cargos en el mismo mes (súper, gasolina) no tiene "precio" que
 * pueda cambiar, y esos meses se descartan. Se agrupa por `comercio` (no
 * por descripción, que trae referencias distintas en cada cargo), así que
 * solo cubre lo que las reglas ya etiquetan con comercio, igual que
 * "Gastos recurrentes". Los cargos con evento se ignoran (gasto puntual).
 */
function cargosMensualesPorComercio(transacciones: Transaccion[]): Map<string, Transaccion[]> {
  const porComercioYMes = new Map<string, Map<string, Transaccion[]>>();
  for (const t of transacciones) {
    if (!esCompra(t) || !t.comercio || eventoDe(t) !== null) continue;
    const porMes = porComercioYMes.get(t.comercio) ?? new Map<string, Transaccion[]>();
    porMes.set(mesDe(t), [...(porMes.get(mesDe(t)) ?? []), t]);
    porComercioYMes.set(t.comercio, porMes);
  }
  const resultado = new Map<string, Transaccion[]>();
  for (const [comercio, porMes] of porComercioYMes) {
    resultado.set(
      comercio,
      Array.from(porMes.values())
        .filter((cargos) => cargos.length === 1)
        .map((cargos) => cargos[0])
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
    );
  }
  return resultado;
}

/**
 * Suscripción que cambió de precio: al menos dos cobros mensuales previos
 * con el mismo monto y luego, dentro del periodo, uno distinto (Netflix
 * pasó de $299 a $329). Solo el cambio más reciente de cada comercio.
 */
export function detectarCambiosDePrecio(transacciones: Transaccion[], periodo: Periodo): Alerta[] {
  const meses = new Set(periodo.meses);
  const alertas: Alerta[] = [];
  for (const [comercio, cargos] of cargosMensualesPorComercio(transacciones)) {
    for (let i = cargos.length - 1; i >= 2; i--) {
      const [antes, previo, nuevo] = [cargos[i - 2].monto, cargos[i - 1].monto, cargos[i].monto];
      const diferencia = nuevo - previo;
      if (
        !meses.has(mesDe(cargos[i])) ||
        !parecidos(antes, previo) ||
        Math.abs(diferencia) < Math.max(CAMBIO_PRECIO_MINIMO * previo, CAMBIO_PRECIO_MINIMO_PESOS) ||
        Math.abs(diferencia) > CAMBIO_PRECIO_MAXIMO * previo
      ) {
        continue;
      }
      const sube = diferencia > 0;
      alertas.push({
        id: `precio:${comercio}:${cargos[i].fecha}`,
        tipo: "cambio-precio",
        tono: sube ? "revisar" : "favorable",
        titulo: `${comercio} ${sube ? "subió" : "bajó"} de precio`,
        detalle: `Pasó de ${monedaExacta.format(previo)} a ${monedaExacta.format(nuevo)} (${sube ? "+" : ""}${porcentaje.format(diferencia / previo)}) en ${nombreMes(mesDe(cargos[i]))}: ${sube ? "+" : "−"}${moneda.format(Math.abs(diferencia) * 12)} al año si se queda así.`,
        importancia: Math.abs(diferencia) * 12,
        filtro: { campo: "comercio", valor: comercio },
      });
      break;
    }
  }
  return alertas;
}

/** Cuántos meses hacia atrás (desde el último del periodo) se considera
 * "nueva" una suscripción. */
const MESES_SUSCRIPCION_NUEVA = 3;

/**
 * Suscripción nueva: un comercio que nunca se había cobrado y que empezó
 * hace poco (sus cargos caen en los últimos `MESES_SUSCRIPCION_NUEVA` meses
 * hasta el fin del periodo) con al menos dos cobros mensuales del mismo
 * monto, el último dentro del periodo. Con un solo cobro aún no se puede
 * distinguir de una compra suelta.
 */
export function detectarSuscripcionesNuevas(transacciones: Transaccion[], periodo: Periodo): Alerta[] {
  const ultimoMes = periodo.meses[periodo.meses.length - 1];
  const recientes = new Set(mesesHasta(ultimoMes, MESES_SUSCRIPCION_NUEVA));
  const meses = new Set(periodo.meses);
  const primerCargo = new Map<string, string>();
  for (const t of transacciones) {
    if (!esCompra(t) || !t.comercio) continue;
    const previo = primerCargo.get(t.comercio);
    if (previo === undefined || t.fecha < previo) primerCargo.set(t.comercio, t.fecha);
  }

  const alertas: Alerta[] = [];
  for (const [comercio, todos] of cargosMensualesPorComercio(transacciones)) {
    const cargos = todos.filter((t) => mesDe(t) <= ultimoMes);
    const inicio = primerCargo.get(comercio);
    if (
      cargos.length < 2 ||
      inicio === undefined ||
      !recientes.has(inicio.slice(0, 7)) ||
      !meses.has(mesDe(cargos[cargos.length - 1])) ||
      !cargos.every((t) => parecidos(t.monto, cargos[0].monto))
    ) {
      continue;
    }
    const monto = cargos[cargos.length - 1].monto;
    alertas.push({
      id: `suscripcion:${comercio}`,
      tipo: "suscripcion-nueva",
      tono: "info",
      titulo: `Suscripción nueva: ${comercio}`,
      detalle: `${monedaExacta.format(monto)} al mes desde ${nombreMes(inicio.slice(0, 7))} (${moneda.format(monto * 12)} al año). Si no la reconoces o ya no la usas, cancélala.`,
      importancia: monto * 12,
      filtro: { campo: "comercio", valor: comercio },
    });
  }
  return alertas;
}

// Un cargo es inusual para su categoría si supera al menos este múltiplo de
// la mediana Y el cargo más grande de los 12 meses previos al periodo, y
// pasa de un monto mínimo (un café de $90 contra una mediana de $30 no es
// noticia). Hace falta un historial mínimo para hablar de "lo normal".
const MULTIPLO_INUSUAL = 3;
const MONTO_MINIMO_INUSUAL = 1000;
const HISTORIAL_MINIMO_INUSUAL = 6;
const TOPE_CARGOS_INUSUALES = 3;

function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[mitad] : (orden[mitad - 1] + orden[mitad]) / 2;
}

/**
 * Cargos del periodo inusualmente grandes para su categoría, comparados con
 * los cargos de esa categoría en los 12 meses previos al periodo. Los
 * cargos con evento se ignoran: un viaje ya explica por qué fue grande.
 * Solo los `TOPE_CARGOS_INUSUALES` más extremos.
 */
export function detectarCargosInusuales(transacciones: Transaccion[], periodo: Periodo): Alerta[] {
  const meses = new Set(periodo.meses);
  const historialMeses = new Set(mesesHasta(periodo.anteriores[periodo.anteriores.length - 1], 12));
  const historial = new Map<string, number[]>();
  for (const t of transacciones) {
    if (!esCompra(t) || !historialMeses.has(mesDe(t))) continue;
    const categoria = categoriaDe(t);
    historial.set(categoria, [...(historial.get(categoria) ?? []), t.monto]);
  }

  return transacciones
    .filter((t) => esCompra(t) && meses.has(mesDe(t)) && eventoDe(t) === null)
    .flatMap((t) => {
      const previos = historial.get(categoriaDe(t)) ?? [];
      if (previos.length < HISTORIAL_MINIMO_INUSUAL || t.monto < MONTO_MINIMO_INUSUAL) return [];
      const tipico = mediana(previos);
      if (t.monto < MULTIPLO_INUSUAL * tipico || t.monto <= Math.max(...previos)) return [];
      return [{ t, tipico, veces: t.monto / tipico }];
    })
    .sort((a, b) => b.veces - a.veces)
    .slice(0, TOPE_CARGOS_INUSUALES)
    .map(({ t, tipico, veces }) => ({
      id: `inusual:${t.id}`,
      tipo: "cargo-inusual" as const,
      tono: "revisar" as const,
      titulo: `Cargo inusual en ${categoriaDe(t)}: ${moneda.format(t.monto)}`,
      detalle: `${t.comercio ?? t.descripcion}, ${nombreDia(t.fecha)} (${cuentaDe(t)}). Es ${decimal.format(veces)} veces tu cargo típico en esa categoría (${moneda.format(tipico)}) y el más alto del último año. Si fue algo puntual, puedes asignarle un evento.`,
      importancia: t.monto,
      filtro: { campo: "categoria" as const, valor: categoriaDe(t) },
    }));
}

/** Cambios de menos de estos puntos de tasa de ahorro no se comentan. */
const CAMBIO_TASA_MINIMO_PUNTOS = 2;

/**
 * La tasa de ahorro del periodo contra la del periodo anterior, explicada en
 * una frase: si cambió por el gasto, la categoría que más se movió; si fue
 * por los ingresos, eso. Mismos meses que el indicador principal.
 */
export function alertaTasaDeAhorro(transacciones: Transaccion[], periodo: Periodo): Alerta[] {
  const suma = (meses: string[]) =>
    resumenPorMes(transacciones, meses).reduce(
      (a, r) => ({ ingresos: a.ingresos + r.ingresos, gastos: a.gastos + r.gastos }),
      { ingresos: 0, gastos: 0 }
    );
  const actual = suma(periodo.meses);
  const anterior = suma(periodo.anteriores);
  if (actual.ingresos <= 0 || anterior.ingresos <= 0) return [];

  const tasa = (actual.ingresos - actual.gastos) / actual.ingresos;
  const tasaAnterior = (anterior.ingresos - anterior.gastos) / anterior.ingresos;
  const puntos = (tasa - tasaAnterior) * 100;
  if (Math.abs(puntos) < CAMBIO_TASA_MINIMO_PUNTOS) return [];

  const n = periodo.meses.length;
  const cambioGasto = (actual.gastos - anterior.gastos) / n;
  const cambioIngreso = (actual.ingresos - anterior.ingresos) / n;
  const bajo = puntos < 0;
  const contra = n === 1 ? nombreMes(periodo.anteriores[0]) : nombrePeriodo(periodo.anteriores);
  const porMes = n === 1 ? "" : " al mes";

  // ¿Qué movió la tasa? Si bajó: más gasto o menos ingreso, lo que pese más
  // (y al revés si subió).
  const porGasto = bajo ? cambioGasto > -cambioIngreso : -cambioGasto > cambioIngreso;
  let causa: string;
  let filtro: Alerta["filtro"];
  if (porGasto) {
    const categoria = categoriaQueMasCambio(transacciones, periodo, bajo);
    causa = categoria
      ? `sobre todo por ${categoria.nombre} (${bajo ? "+" : "−"}${moneda.format(Math.abs(categoria.diferencia))}${porMes} vs. ${contra})`
      : `porque gastaste ${moneda.format(Math.abs(cambioGasto))}${porMes} ${bajo ? "más" : "menos"}`;
    if (categoria) filtro = { campo: "categoria", valor: categoria.nombre };
  } else {
    causa = `porque tus ingresos ${bajo ? "bajaron" : "subieron"} ${moneda.format(Math.abs(cambioIngreso))}${porMes}`;
  }

  return [
    {
      id: "tasa-ahorro",
      tipo: "tasa-ahorro",
      tono: bajo ? "revisar" : "favorable",
      titulo: `Tu tasa de ahorro ${bajo ? "bajó" : "subió"} ${decimal.format(Math.abs(puntos))} puntos`,
      detalle: `De ${porcentaje.format(tasaAnterior)} en ${contra} a ${porcentaje.format(tasa)}, ${causa}.`,
      importancia: Math.abs(cambioGasto) + Math.abs(cambioIngreso),
      filtro,
    },
  ];
}

/** La categoría cuyo gasto mensual promedio más subió (o bajó) contra el
 * periodo anterior de la misma duración. */
function categoriaQueMasCambio(
  transacciones: Transaccion[],
  periodo: Periodo,
  subio: boolean
): { nombre: string; diferencia: number } | null {
  const actuales = new Set(periodo.meses);
  const anteriores = new Set(periodo.anteriores);
  const diferencias = new Map<string, number>();
  for (const t of transacciones) {
    if (t.tipo !== "cargo") continue;
    const signo = actuales.has(mesDe(t)) ? 1 : anteriores.has(mesDe(t)) ? -1 : 0;
    if (signo === 0) continue;
    diferencias.set(categoriaDe(t), (diferencias.get(categoriaDe(t)) ?? 0) + (signo * t.monto) / periodo.meses.length);
  }
  const candidatas = Array.from(diferencias.entries()).filter(([, d]) => (subio ? d > 0 : d < 0));
  if (candidatas.length === 0) return null;
  const [nombre, diferencia] = candidatas.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return { nombre, diferencia };
}
