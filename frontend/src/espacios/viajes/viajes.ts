// Lógica pura del espacio Viajes (sin React, probada en viajes.test.ts).
//
// Los datos vienen de la "Bitácora de viajes" (repo romezamario/GestionViajes)
// por /api/viajes (functions/api/viajes). Aquí solo se leen: se editan en la
// bitácora. La forma de cada viaje es la que guarda esa app (campos en inglés):
// name, destination, start/end (AAAA-MM-DD), currency, lodging[], tickets[],
// days{fecha: {title, places[]}}, checklist[].

export interface Alojamiento {
  id?: string;
  name: string;
  address?: string;
  checkIn?: string;
  checkOut?: string;
  checkInTime?: string;
  checkOutTime?: string;
  confirmation?: string;
  price?: number | string;
}

export interface Ticket {
  id?: string;
  kind?: string;
  title: string;
  from?: string;
  to?: string;
  date?: string;
  time?: string;
  arrival?: string;
  provider?: string;
  code?: string;
  seat?: string;
  price?: number | string;
}

export interface Lugar {
  id?: string;
  name: string;
  time?: string;
  category?: string;
  address?: string;
  cost?: number | string;
  done?: boolean;
}

export interface Dia {
  title?: string;
  notes?: string;
  places?: Lugar[];
}

export interface Viaje {
  id: string;
  name: string;
  destination?: string;
  start?: string;
  end?: string;
  currency?: string;
  travelers?: string;
  notes?: string;
  lodging: Alojamiento[];
  tickets: Ticket[];
  days: Record<string, Dia>;
  checklist: { id?: string; text: string; done?: boolean }[];
}

export type EstadoViaje = "en_curso" | "proximo" | "pasado" | "sin_fechas";

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const esFecha = (s: unknown): s is string => typeof s === "string" && PATRON_FECHA.test(s);
const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** De `{ id: viaje }` (lo que guarda la bitácora) a una lista limpia: descarta
 * lo que no tiene nombre y asegura que las listas existan. */
export function normalizarViajes(crudos: Record<string, unknown> | null | undefined): Viaje[] {
  const salida: Viaje[] = [];
  for (const [id, v] of Object.entries(crudos ?? {})) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const t = v as Record<string, unknown>;
    if (typeof t.name !== "string" || !t.name.trim()) continue;
    salida.push({
      ...(t as unknown as Viaje),
      id,
      name: t.name.trim(),
      start: esFecha(t.start) ? t.start : undefined,
      end: esFecha(t.end) ? t.end : esFecha(t.start) ? t.start : undefined,
      lodging: lista<Alojamiento>(t.lodging).filter((l) => l && typeof l.name === "string"),
      tickets: lista<Ticket>(t.tickets).filter((k) => k && typeof k.title === "string"),
      days: t.days && typeof t.days === "object" && !Array.isArray(t.days) ? (t.days as Record<string, Dia>) : {},
      checklist: lista<{ text: string; done?: boolean }>(t.checklist).filter((c) => c && typeof c.text === "string"),
    });
  }
  return salida;
}

/** Fecha local AAAA-MM-DD (no UTC: a las 20:00 en CDMX ya es "mañana" en UTC). */
export function hoyIso(ahora = new Date()): string {
  const d = ahora;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const aDia = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d) / 864e5;
};

/** Días de `a` a `b` (b − a), contando por fecha de calendario. */
export function diasEntre(a: string, b: string): number {
  return aDia(b) - aDia(a);
}

export function sumarDias(iso: string, n: number): string {
  const d = new Date((aDia(iso) + n) * 864e5);
  return d.toISOString().slice(0, 10);
}

/** Todas las fechas del viaje, de la ida a la vuelta (máx. 120, como la bitácora). */
export function fechasDelViaje(v: Viaje): string[] {
  if (!v.start || !v.end) return [];
  const n = Math.min(diasEntre(v.start, v.end), 119);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => sumarDias(v.start!, i));
}

export function estadoViaje(v: Viaje, hoy: string): EstadoViaje {
  if (!v.start) return "sin_fechas";
  if (hoy < v.start) return "proximo";
  if (v.end && hoy > v.end) return "pasado";
  return "en_curso";
}

/** "Sale mañana", "Faltan 12 días", "Día 3 de 8", "Terminó hace 5 días". */
export function cuentaRegresiva(v: Viaje, hoy: string): string {
  const estado = estadoViaje(v, hoy);
  if (estado === "sin_fechas") return "Sin fechas";
  if (estado === "proximo") {
    const n = diasEntre(hoy, v.start!);
    return n === 1 ? "Sale mañana" : `Faltan ${n} días`;
  }
  if (estado === "pasado") {
    const n = diasEntre(v.end!, hoy);
    return n === 1 ? "Terminó ayer" : `Terminó hace ${n} días`;
  }
  return `Día ${diasEntre(v.start!, hoy) + 1} de ${fechasDelViaje(v).length}`;
}

export interface ViajesClasificados {
  enCurso: Viaje[];
  /** Del más cercano al más lejano. */
  proximos: Viaje[];
  /** Del más reciente al más antiguo. */
  pasados: Viaje[];
  sinFechas: Viaje[];
}

export function clasificarViajes(viajes: readonly Viaje[], hoy: string): ViajesClasificados {
  const r: ViajesClasificados = { enCurso: [], proximos: [], pasados: [], sinFechas: [] };
  for (const v of viajes) {
    const e = estadoViaje(v, hoy);
    if (e === "en_curso") r.enCurso.push(v);
    else if (e === "proximo") r.proximos.push(v);
    else if (e === "pasado") r.pasados.push(v);
    else r.sinFechas.push(v);
  }
  const porInicio = (a: Viaje, b: Viaje) => (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name, "es");
  r.enCurso.sort(porInicio);
  r.proximos.sort(porInicio);
  r.pasados.sort((a, b) => porInicio(b, a));
  r.sinFechas.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return r;
}

const numero = (x: unknown) => {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Lo mismo que suma la bitácora: alojamientos + tickets + costo de cada lugar. */
export function gastoPrevisto(v: Viaje): number {
  let total = 0;
  for (const l of v.lodging) total += numero(l.price);
  for (const k of v.tickets) total += numero(k.price);
  for (const d of Object.values(v.days)) for (const p of lista<Lugar>(d?.places)) total += numero(p.cost);
  return total;
}

export function lugaresDelViaje(v: Viaje): number {
  return Object.values(v.days).reduce((n, d) => n + lista(d?.places).length, 0);
}

export function pendientesDeLista(v: Viaje): number {
  return v.checklist.filter((c) => !c.done).length;
}

/** El alojamiento donde se duerme la noche de `fecha` (check-in ≤ fecha < check-out). */
export function alojamientoDeNoche(v: Viaje, fecha: string): Alojamiento | undefined {
  return v.lodging.find((l) => esFecha(l.checkIn) && esFecha(l.checkOut) && fecha >= l.checkIn && fecha < l.checkOut);
}

/** Noches del viaje (de la ida a la víspera de la vuelta) sin alojamiento. */
export function nochesSinAlojamiento(v: Viaje): string[] {
  return fechasDelViaje(v)
    .slice(0, -1)
    .filter((f) => !alojamientoDeNoche(v, f));
}

const porFechaHora = (a: Ticket, b: Ticket) => `${a.date ?? ""}${a.time ?? ""}`.localeCompare(`${b.date ?? ""}${b.time ?? ""}`);

/** Tickets de hoy en adelante, en orden (los sin fecha al final). */
export function proximosTickets(v: Viaje, hoy: string, maximo = 3): Ticket[] {
  const conFecha = v.tickets.filter((k) => esFecha(k.date) && k.date >= hoy).sort(porFechaHora);
  return conFecha.slice(0, maximo);
}

export function ticketsDelDia(v: Viaje, fecha: string): Ticket[] {
  return v.tickets.filter((k) => k.date === fecha).sort(porFechaHora);
}

export interface PlanDelDia {
  titulo?: string;
  lugares: Lugar[];
  tickets: Ticket[];
  alojamiento?: Alojamiento;
}

export function planDelDia(v: Viaje, fecha: string): PlanDelDia {
  const d = v.days[fecha];
  const lugares = [...lista<Lugar>(d?.places)].sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  return { titulo: d?.title || undefined, lugares, tickets: ticketsDelDia(v, fecha), alojamiento: alojamientoDeNoche(v, fecha) };
}

/** Viajes que tocan el año y cuántos días de ese año se pasan viajando
 * (un día con dos viajes cuenta una vez). */
export function resumenDelAnio(viajes: readonly Viaje[], anio: number): { viajes: number; dias: number } {
  const desde = `${anio}-01-01`;
  const hasta = `${anio}-12-31`;
  const dias = new Set<string>();
  let n = 0;
  for (const v of viajes) {
    const fechas = fechasDelViaje(v).filter((f) => f >= desde && f <= hasta);
    if (fechas.length === 0) continue;
    n++;
    for (const f of fechas) dias.add(f);
  }
  return { viajes: n, dias: dias.size };
}

/** Monto con la moneda del viaje (MXN si no tiene o el código no es válido). */
export function formatoMonto(n: number, moneda?: string): string {
  const codigo = (moneda || "MXN").trim().toUpperCase();
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: codigo, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n)} ${codigo}`;
  }
}

/** Liga a la bitácora abierta en ese viaje (la bitácora lee `#viaje=<id>`). */
export function enlaceBitacora(base: string, id?: string): string {
  const raiz = base.replace(/\/+$/, "") + "/";
  return id ? `${raiz}#viaje=${encodeURIComponent(id)}` : raiz;
}

const formatoFecha = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
const formatoFechaAnio = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const formatoDiaSemana = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const aFecha = (iso: string) => new Date(aDia(iso) * 864e5);

export function fechaCorta(iso: string): string {
  return formatoFecha.format(aFecha(iso));
}

export function fechaConDia(iso: string): string {
  return formatoDiaSemana.format(aFecha(iso));
}

/** "3 – 10 dic 2026", "28 dic – 4 ene 2027" o "12 mar 2027". */
export function rangoFechas(v: Viaje): string {
  if (!v.start) return "Sin fechas";
  if (!v.end || v.end === v.start) return formatoFechaAnio.format(aFecha(v.start));
  const mismoAnio = v.start.slice(0, 4) === v.end.slice(0, 4);
  const mismoMes = mismoAnio && v.start.slice(5, 7) === v.end.slice(5, 7);
  const ini = mismoMes ? String(Number(v.start.slice(8))) : mismoAnio ? fechaCorta(v.start) : formatoFechaAnio.format(aFecha(v.start));
  return `${ini} – ${formatoFechaAnio.format(aFecha(v.end))}`;
}
