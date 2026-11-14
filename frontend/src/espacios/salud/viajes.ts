// Vista de viaje (Mario, 2026-11-14: "marcar los días en Las Vegas para ver
// cómo te afectan el cambio de horario y el viaje"). Viajes marcados a mano
// (tabla salud.viajes) + días que la laptop estuvo en otra zona horaria
// (colector v2+, ver colector.ts). Funciones puras probadas en viajes.test.ts.
import { supabase } from "../../lib/supabase";
import { UTC_OFFSET_CASA } from "./colector";
import { recuperacion, type DiaEstres } from "./indicadores";
import { horarioSueno, minutosDormido, num, promedio, restarDias, type DiaSalud } from "./salud";

export interface Viaje {
  id: number;
  lugar: string;
  desde: string;
  /** null = sigue en curso. */
  hasta: string | null;
  offset: number | null;
}

interface FilaViaje {
  id: number;
  lugar: string;
  desde: string;
  hasta: string | null;
  utc_offset_min: number | null;
}

const aViaje = (f: FilaViaje): Viaje => ({ id: f.id, lugar: f.lugar, desde: f.desde, hasta: f.hasta, offset: f.utc_offset_min });

export async function obtenerViajes(): Promise<Viaje[]> {
  const { data, error } = await supabase.schema("salud").from("viajes").select("id, lugar, desde, hasta, utc_offset_min").order("desde");
  if (error) throw error;
  return ((data ?? []) as FilaViaje[]).map(aViaje);
}

export async function guardarViaje(v: Omit<Viaje, "id"> & { id?: number }): Promise<void> {
  const fila = { lugar: v.lugar.trim(), desde: v.desde, hasta: v.hasta || null, utc_offset_min: v.offset };
  const consulta = v.id
    ? supabase.schema("salud").from("viajes").update(fila).eq("id", v.id)
    : supabase.schema("salud").from("viajes").insert(fila);
  const { error } = await consulta;
  if (error) throw error;
}

export async function borrarViaje(id: number): Promise<void> {
  const { error } = await supabase.schema("salud").from("viajes").delete().eq("id", id);
  if (error) throw error;
}

/** Revisa un viaje antes de guardarlo; devuelve el problema o null. */
export function problemaViaje(v: { lugar: string; desde: string; hasta: string | null }): string | null {
  if (!v.lugar.trim()) return "Escribe el lugar.";
  if (v.lugar.trim().length > 80) return "El lugar es demasiado largo.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.desde)) return "Elige la fecha de salida.";
  if (v.hasta && v.hasta < v.desde) return "El regreso no puede ser antes de la salida.";
  return null;
}

// ------------------------------------------------- días fuera de casa

export interface TramoFuera {
  desde: string;
  hasta: string;
  offset: number;
}

const sumarDias = (f: string, n: number) => restarDias(f, -n);

/** Días seguidos en que la laptop estuvo en una zona distinta a la de casa
 * (un día sin lecturas en medio no corta el tramo). */
export function tramosFueraDeCasa(zonas: ReadonlyMap<string, number>, casa = UTC_OFFSET_CASA): TramoFuera[] {
  const tramos: TramoFuera[] = [];
  for (const [fecha, offset] of [...zonas].sort(([a], [b]) => a.localeCompare(b))) {
    if (offset === casa) continue;
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.offset === offset && fecha <= sumarDias(ultimo.hasta, 2)) ultimo.hasta = fecha;
    else tramos.push({ desde: fecha, hasta: fecha, offset });
  }
  return tramos;
}

/** Tramos detectados que no caen dentro de ningún viaje marcado. */
export function tramosSinMarcar(tramos: readonly TramoFuera[], viajes: readonly Viaje[], hoy: string): TramoFuera[] {
  return tramos.filter((t) => !viajes.some((v) => t.desde <= (v.hasta ?? hoy) && t.hasta >= v.desde));
}

/** Todas las fechas que caen en algún viaje marcado. */
export function fechasDeViaje(viajes: readonly Viaje[], hoy: string): Set<string> {
  const s = new Set<string>();
  for (const v of viajes) {
    for (let f = v.desde; f <= (v.hasta ?? hoy) && s.size < 5000; f = sumarDias(f, 1)) s.add(f);
  }
  return s;
}

// --------------------------------------------- efecto de un viaje

/** Días antes del viaje con los que se compara y días "de regreso". */
export const DIAS_ANTES_VIAJE = 14;
export const DIAS_REGRESO = 3;

export type ClaveEfecto = "sueno" | "dormir" | "hrv" | "rhr" | "recuperacion" | "estres";

export interface ValorTramo {
  valor: number | null;
  n: number;
}

export interface FilaEfecto {
  clave: ClaveEfecto;
  nombre: string;
  /** true = más alto es mejor; null = ni mejor ni peor (hora de dormir). */
  mejorAlto: boolean | null;
  antes: ValorTramo;
  durante: ValorTramo;
  despues: ValorTramo;
}

export interface EfectoViaje {
  viaje: Viaje;
  hasta: string;
  enCurso: boolean;
  filas: FilaEfecto[];
  /** Diferencia de horario contra casa (h), si se conoce. */
  cambioHoras: number | null;
}

/** % del tiempo despierto y en reposo con estrés (≥ 2 h juzgadas), por día. */
export function porcentajeEstres(estres: readonly DiaEstres[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of estres) {
    const juzgados = d.minutos.estres + d.minutos.normal + d.minutos.recuperacion;
    if (juzgados >= 120) m.set(d.fecha, Math.round((d.minutos.estres / juzgados) * 100));
  }
  return m;
}

export interface LectorDia {
  clave: ClaveEfecto;
  nombre: string;
  mejorAlto: boolean | null;
  leer: (d: DiaSalud) => number | null;
}

/** Lo que se compara por día (lo usan el viaje y el resumen semanal). */
export function lectoresDia(dias: readonly DiaSalud[], estres: readonly DiaEstres[]): LectorDia[] {
  const pctEstres = porcentajeEstres(estres);
  const dormir = new Map(horarioSueno(dias).map((h) => [h.fecha, h.rango[0]]));
  const recup = new Map<string, number>();
  for (const d of dias) {
    if (!d.noche) continue;
    const r = recuperacion(dias, d.fecha);
    if (r) recup.set(d.fecha, r.puntaje);
  }
  return [
    { clave: "sueno", nombre: "Sueño (min)", mejorAlto: true, leer: (d) => minutosDormido(d.noche) },
    { clave: "dormir", nombre: "Hora de dormir", mejorAlto: null, leer: (d) => dormir.get(d.fecha) ?? null },
    { clave: "hrv", nombre: "HRV (ms)", mejorAlto: true, leer: (d) => num(d.noche?.hrv_ms) },
    { clave: "rhr", nombre: "FC en reposo (lpm)", mejorAlto: false, leer: (d) => num(d.noche?.rhr) },
    { clave: "recuperacion", nombre: "Recuperación (0–100)", mejorAlto: true, leer: (d) => recup.get(d.fecha) ?? null },
    { clave: "estres", nombre: "Estrés de día (% en reposo)", mejorAlto: false, leer: (d) => pctEstres.get(d.fecha) ?? null },
  ];
}

export function promedioTramo(dias: readonly DiaSalud[], desde: string, hasta: string, leer: (d: DiaSalud) => number | null): ValorTramo {
  const v = dias.filter((d) => d.fecha >= desde && d.fecha <= hasta).map(leer).filter((x): x is number => x !== null);
  return { valor: promedio(v), n: v.length };
}

export function efectoViaje(
  dias: readonly DiaSalud[],
  estres: readonly DiaEstres[],
  viaje: Viaje,
  hoy: string,
  zonas: ReadonlyMap<string, number> = new Map(),
): EfectoViaje {
  const hasta = viaje.hasta ?? hoy;
  const lectores = lectoresDia(dias, estres);
  const antesDesde = restarDias(viaje.desde, DIAS_ANTES_VIAJE);
  const antesHasta = restarDias(viaje.desde, 1);
  const despuesDesde = sumarDias(hasta, 1);
  const despuesHasta = sumarDias(hasta, DIAS_REGRESO);
  // La noche que termina el día de salida todavía es en casa; cuenta como "antes".
  const filas = lectores.map((l) => ({
    clave: l.clave,
    nombre: l.nombre,
    mejorAlto: l.mejorAlto,
    antes: promedioTramo(dias, antesDesde, antesHasta, l.leer),
    durante: promedioTramo(dias, viaje.desde, hasta, l.leer),
    despues: viaje.hasta ? promedioTramo(dias, despuesDesde, despuesHasta, l.leer) : { valor: null, n: 0 },
  }));
  let offset = viaje.offset;
  if (offset === null) {
    const enViaje = [...zonas].filter(([f]) => f >= viaje.desde && f <= hasta).map(([, o]) => o);
    offset = enViaje.find((o) => o !== UTC_OFFSET_CASA) ?? null;
  }
  return { viaje, hasta, enCurso: !viaje.hasta, filas, cambioHoras: offset === null ? null : (offset - UTC_OFFSET_CASA) / 60 };
}

/** Veredicto de "durante" contra "antes": mejor / peor / igual / sin dato. */
export type Veredicto = "mejor" | "peor" | "igual" | "sin-dato";

/** Cambio mínimo para dejar de ser "igual", por métrica. */
export const UMBRAL_CAMBIO: Record<ClaveEfecto, number> = { sueno: 15, dormir: 30, hrv: 3, rhr: 2, recuperacion: 5, estres: 5 };

export function veredicto(clave: ClaveEfecto, mejorAlto: boolean | null, antes: ValorTramo, ahora: ValorTramo, minimo = 1): Veredicto {
  if (antes.valor === null || ahora.valor === null || antes.n < minimo || ahora.n < minimo) return "sin-dato";
  const d = ahora.valor - antes.valor;
  if (Math.abs(d) < UMBRAL_CAMBIO[clave]) return "igual";
  if (mejorAlto === null) return "igual";
  return (d > 0) === mejorAlto ? "mejor" : "peor";
}
