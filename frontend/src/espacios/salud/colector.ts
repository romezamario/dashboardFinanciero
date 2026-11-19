// Estado del colector de la laptop y zona horaria por día (Mario, 2026-11-14).
// El colector (repo romezamario/oura, colector/subir_oura.py) anota en cada
// fila de `oura_sincronizaciones` su versión, si quedó al día con el repo
// (colector/actualizar_colector.py) y la zona horaria de la laptop.
import { supabase } from "../../lib/supabase";
import { num } from "./salud";

/** Versión mínima del colector que este dashboard necesita. Súbela junto con
 * VERSION_COLECTOR de colector/subir_oura.py cuando una gráfica nueva dependa
 * de un dato nuevo del colector: si la laptop quedó atrás, Salud lo avisa
 * (así se habría visto el primer día que el panel de estrés quedó vacío). */
export const VERSION_COLECTOR_ESPERADA = 6;

/** Ciudad de México: UTC−6 todo el año (sin horario de verano desde 2022). */
export const UTC_OFFSET_CASA = -360;

export interface EstadoColector {
  subidaEn: string;
  /** null = colector anterior a que existiera la versión (equivale a 1). */
  version: number | null;
  commit: string | null;
  alDia: boolean | null;
  error: string | null;
}

export interface AvisoColector {
  titulo: string;
  detalle: string;
}

/** Aviso SOLO cuando el colector está desactualizado (Mario: "solo si el
 * colector está desactualizado"); horas sin datos no avisan. */
export function avisoColector(e: EstadoColector | null): AvisoColector | null {
  if (!e) return null;
  const version = e.version ?? 1;
  if (version < VERSION_COLECTOR_ESPERADA) {
    return {
      titulo: "El colector de la laptop está desactualizado",
      detalle:
        `La laptop sube con la versión ${version} del colector y este dashboard necesita la ${VERSION_COLECTOR_ESPERADA}: ` +
        "algunos paneles pueden quedar vacíos. " +
        (e.version === null
          ? "Esa versión todavía no se actualiza sola: hay que copiar el colector nuevo una vez a la laptop."
          : "Debería actualizarse sola en la siguiente lectura horaria" + (e.error ? `; el último intento falló: ${e.error}.` : ".")),
    };
  }
  if (e.alDia === false) {
    return {
      titulo: "El colector de la laptop no pudo actualizarse",
      detalle: `Hay una versión nueva en el repo y la laptop sigue con la ${e.commit?.slice(0, 7) ?? "anterior"}${e.error ? `: ${e.error}` : ""}.`,
    };
  }
  return null;
}

interface FilaEstado {
  subida_en: string;
  version_colector?: number | null;
  colector_commit?: string | null;
  colector_al_dia?: boolean | null;
  actualizacion_error?: string | null;
}

export function filaAEstado(f: FilaEstado): EstadoColector {
  return {
    subidaEn: f.subida_en,
    version: num(f.version_colector),
    commit: f.colector_commit ?? null,
    alDia: typeof f.colector_al_dia === "boolean" ? f.colector_al_dia : null,
    error: f.actualizacion_error ?? null,
  };
}

/** Última subida de la laptop con los datos de su colector. Si la migración
 * de esas columnas aún no está aplicada, null (sin aviso). */
export async function obtenerEstadoColector(): Promise<EstadoColector | null> {
  const { data, error } = await supabase
    .schema("salud")
    .from("oura_sincronizaciones")
    .select("subida_en, version_colector, colector_commit, colector_al_dia, actualizacion_error")
    .eq("origen", "laptop")
    .order("subida_en", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return filaAEstado(data[0] as FilaEstado);
}

// ------------------------------------------------- zona horaria por día

export interface LecturaZona {
  subidaEn: string;
  offset: number;
}

/** Zona de la laptop de las lecturas que la traen (colector v2+). */
export async function obtenerZonas(): Promise<LecturaZona[]> {
  const salida: LecturaZona[] = [];
  for (let desde = 0; desde < 20000; desde += 1000) {
    const { data, error } = await supabase
      .schema("salud")
      .from("oura_sincronizaciones")
      .select("subida_en, utc_offset_min")
      .eq("origen", "laptop")
      .not("utc_offset_min", "is", null)
      .order("subida_en", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    if (error) throw error;
    for (const f of (data ?? []) as { subida_en: string; utc_offset_min: number }[]) salida.push({ subidaEn: f.subida_en, offset: f.utc_offset_min });
    if (!data || data.length < 1000) break;
  }
  return salida;
}

/** Fecha local (AAAA-MM-DD) de un instante con ese desfase. */
export function fechaLocal(iso: string, offset: number): string {
  return new Date(Date.parse(iso) + offset * 60000).toISOString().slice(0, 10);
}

/** Por día local: el desfase más frecuente de las lecturas de ese día. */
export function zonaPorDia(lecturas: readonly LecturaZona[]): Map<string, number> {
  const conteo = new Map<string, Map<number, number>>();
  for (const l of lecturas) {
    const f = fechaLocal(l.subidaEn, l.offset);
    const c = conteo.get(f) ?? new Map<number, number>();
    c.set(l.offset, (c.get(l.offset) ?? 0) + 1);
    conteo.set(f, c);
  }
  const salida = new Map<string, number>();
  for (const [f, c] of [...conteo].sort(([a], [b]) => a.localeCompare(b))) {
    salida.set(f, [...c].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]);
  }
  return salida;
}

export function textoZona(offset: number): string {
  const h = Math.abs(offset) / 60;
  return `UTC${offset < 0 ? "−" : "+"}${Number.isInteger(h) ? h : h.toFixed(1)}`;
}

/** Añade la zona de los días del historial de la app de Oura (antes de que
 * la laptop leyera el anillo), así los viajes viejos también se ofrecen como
 * "¿Fue un viaje?". La de la laptop gana si hay de las dos. */
export function conZonasDeLaApp(
  porDia: ReadonlyMap<string, number>,
  dias: readonly { fecha: string; origen?: string; utcOffset?: number }[],
): Map<string, number> {
  const salida = new Map(porDia);
  for (const d of dias) {
    if (d.origen !== "anillo" && typeof d.utcOffset === "number" && !salida.has(d.fecha)) salida.set(d.fecha, d.utcOffset);
  }
  return new Map([...salida].sort(([a], [b]) => a.localeCompare(b)));
}
