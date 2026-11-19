// Reporte semanal por correo (Mario, 2026-11-18: "reporte semanal automático
// cada lunes"). Es la pestaña Semana (semanal.ts) + actividad y ejercicio, en
// un correo HTML que arma scripts/reporte-salud/ y envía un workflow de GitHub
// Actions cada lunes a las 8:00 de Ciudad de México. Aquí solo funciones puras.
import { META_SEMANAL_MIN, sinDescartadas, type EtiquetaEjercicio } from "./ejercicio";
import { fechaCorta } from "./formatoSalud";
import { estresDiurno } from "./indicadores";
import { num, promedio, restarDias, type DiaSalud } from "./salud";
import { diferencia, domingoDe, formato, MINIMO_DIAS_SEMANA, resumenSemanal } from "./semanal";
import type { Veredicto } from "./viajes";

export type GrupoReporte = "Sueño" | "Recuperación" | "Estrés" | "Actividad" | "Ejercicio";
export const ORDEN_GRUPOS: readonly GrupoReporte[] = ["Sueño", "Recuperación", "Estrés", "Actividad", "Ejercicio"];

export interface FilaReporte {
  grupo: GrupoReporte;
  nombre: string;
  actual: string;
  /** Días con dato esta semana (null = total de la semana, no promedio). */
  diasActual: number | null;
  anterior: string;
  cambio: string | null;
  veredicto: Veredicto;
}

export interface EjercicioSemana {
  sesiones: number;
  minutos: number;
  /** Moderados + 2 × vigorosos (la cuenta de la OMS). */
  equivalentes: number;
  /** Días de la semana con algún dato del anillo. */
  diasConDatos: number;
}

export interface ReporteSemanal {
  lunes: string;
  domingo: string;
  noches: number;
  diasConDatos: number;
  filas: FilaReporte[];
  ejercicio: EjercicioSemana;
  ejercicioAnterior: EjercicioSemana;
}

/** Cambio mínimo para dejar de ser "igual" en lo que no está en la pestaña Semana. */
export const UMBRAL_REPORTE = { pasos: 1000, kcal: 50, equivalentes: 20, sesiones: 1 } as const;

const mil = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

function veredictoSimple(mejorAlto: boolean, antes: number | null, ahora: number | null, umbral: number, valido: boolean): Veredicto {
  if (!valido || antes === null || ahora === null) return "sin-dato";
  const d = ahora - antes;
  if (Math.abs(d) < umbral) return "igual";
  return (d > 0) === mejorAlto ? "mejor" : "peor";
}

const conSigno = (d: number, unidad = "") => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${mil.format(Math.abs(Math.round(d)))}${unidad}`;

function ejercicioDe(dias: readonly DiaSalud[], desde: string, hasta: string): EjercicioSemana {
  const semana = dias.filter((d) => d.fecha >= desde && d.fecha <= hasta);
  const sesiones = semana.flatMap((d) => d.ejercicio ?? []);
  return {
    sesiones: sesiones.length,
    minutos: sesiones.reduce((t, s) => t + s.duracion_min, 0),
    equivalentes: sesiones.reduce((t, s) => t + s.min_moderados + 2 * s.min_vigorosos, 0),
    diasConDatos: semana.length,
  };
}

function filaPromedio(
  dias: readonly DiaSalud[],
  lunes: string,
  nombre: string,
  leer: (d: DiaSalud) => number | null,
  umbral: number,
  unidad: string,
): FilaReporte {
  const tramo = (desde: string, hasta: string) => {
    const v = dias.filter((d) => d.fecha >= desde && d.fecha <= hasta).map(leer).filter((x): x is number => x !== null);
    return { valor: promedio(v), n: v.length };
  };
  const actual = tramo(lunes, domingoDe(lunes));
  const anterior = tramo(restarDias(lunes, 7), restarDias(lunes, 1));
  const texto = (v: number | null) => (v === null ? "—" : `${mil.format(Math.round(v))}${unidad}`);
  return {
    grupo: "Actividad",
    nombre,
    actual: texto(actual.valor),
    diasActual: actual.n,
    anterior: texto(anterior.valor),
    cambio: actual.valor === null || anterior.valor === null ? null : conSigno(actual.valor - anterior.valor),
    veredicto: veredictoSimple(true, anterior.valor, actual.valor, umbral, actual.n >= MINIMO_DIAS_SEMANA && anterior.n >= MINIMO_DIAS_SEMANA),
  };
}

/** Todo lo del correo de la semana que empieza en `lunes`. `dias` debe traer
 * al menos ~5 semanas antes (la recuperación y el estrés se miden contra tu
 * normal de los días previos). */
export function armarReporte(dias: readonly DiaSalud[], etiquetas: readonly EtiquetaEjercicio[], lunes: string): ReporteSemanal {
  const domingo = domingoDe(lunes);
  const semana = resumenSemanal(dias, estresDiurno(dias), lunes);
  const filas: FilaReporte[] = semana.cambios.map((c) => ({
    grupo: c.grupo,
    nombre: c.nombre.replace(/ \(min\)$/, ""),
    actual: formato(c.clave, c.actual.valor),
    diasActual: c.actual.n,
    anterior: formato(c.clave, c.anterior.valor),
    cambio: diferencia(c.clave, c.anterior.valor, c.actual.valor),
    veredicto: c.veredicto,
  }));
  filas.push(
    filaPromedio(dias, lunes, "Pasos por día", (d) => num(d.actividad?.steps), UMBRAL_REPORTE.pasos, ""),
    filaPromedio(dias, lunes, "Calorías activas por día", (d) => num(d.actividad?.active_kcal), UMBRAL_REPORTE.kcal, " kcal"),
  );
  const limpios = sinDescartadas(dias, etiquetas);
  const ejercicio = ejercicioDe(limpios, lunes, domingo);
  const ejercicioAnterior = ejercicioDe(limpios, restarDias(lunes, 7), restarDias(lunes, 1));
  const comparable = ejercicio.diasConDatos >= MINIMO_DIAS_SEMANA && ejercicioAnterior.diasConDatos >= MINIMO_DIAS_SEMANA;
  filas.push(
    {
      grupo: "Ejercicio",
      nombre: "Minutos de ejercicio (OMS)",
      actual: `${mil.format(ejercicio.equivalentes)} de ${META_SEMANAL_MIN}`,
      diasActual: null,
      anterior: ejercicioAnterior.diasConDatos ? mil.format(ejercicioAnterior.equivalentes) : "—",
      cambio: ejercicioAnterior.diasConDatos ? conSigno(ejercicio.equivalentes - ejercicioAnterior.equivalentes, " min") : null,
      veredicto: veredictoSimple(true, ejercicioAnterior.equivalentes, ejercicio.equivalentes, UMBRAL_REPORTE.equivalentes, comparable),
    },
    {
      grupo: "Ejercicio",
      nombre: "Sesiones",
      actual: mil.format(ejercicio.sesiones),
      diasActual: null,
      anterior: ejercicioAnterior.diasConDatos ? mil.format(ejercicioAnterior.sesiones) : "—",
      cambio: ejercicioAnterior.diasConDatos ? conSigno(ejercicio.sesiones - ejercicioAnterior.sesiones) : null,
      veredicto: veredictoSimple(true, ejercicioAnterior.sesiones, ejercicio.sesiones, UMBRAL_REPORTE.sesiones, comparable),
    },
  );
  return {
    lunes,
    domingo,
    noches: semana.noches,
    diasConDatos: ejercicio.diasConDatos,
    filas,
    ejercicio,
    ejercicioAnterior,
  };
}

// ------------------------------------------------------------- texto

const nombreCorto = (f: FilaReporte) => f.nombre.replace(/ \(.*\)$/, "").replace(/ por día$/, "");

/** Frases de arriba del correo: qué mejoró, qué empeoró y el ejercicio vs. la meta. */
export function frasesReporte(r: ReporteSemanal): string[] {
  if (!r.diasConDatos) return ["No llegaron datos del anillo esta semana. Revisa que el colector de la laptop esté leyendo."];
  const mejoro = r.filas.filter((f) => f.veredicto === "mejor").map(nombreCorto);
  const empeoro = r.filas.filter((f) => f.veredicto === "peor").map(nombreCorto);
  const frases: string[] = [];
  if (mejoro.length) frases.push(`Mejoró: ${lista(mejoro)}.`);
  if (empeoro.length) frases.push(`Empeoró: ${lista(empeoro)}.`);
  if (!mejoro.length && !empeoro.length)
    frases.push(
      r.filas.some((f) => f.veredicto === "igual")
        ? "Una semana pareja: nada cambió lo suficiente contra la anterior."
        : "Todavía no hay dos semanas con al menos 3 días de datos para comparar.",
    );
  const e = r.ejercicio;
  const falta = META_SEMANAL_MIN - e.equivalentes;
  frases.push(
    e.sesiones === 0
      ? `No se detectaron sesiones de ejercicio (meta OMS: ${META_SEMANAL_MIN} min).`
      : `Ejercicio: ${e.sesiones} ${e.sesiones === 1 ? "sesión" : "sesiones"}, ${mil.format(e.minutos)} min; ` +
          (falta <= 0 ? `cumpliste los ${META_SEMANAL_MIN} min de la OMS.` : `te faltaron ${mil.format(falta)} min para los ${META_SEMANAL_MIN} de la OMS.`),
  );
  frases.push(`${r.noches} de 7 noches con datos.`);
  return frases;
}

function lista(x: readonly string[]): string {
  return x.length < 2 ? (x[0] ?? "") : `${x.slice(0, -1).join(", ")} y ${x.at(-1)}`;
}

export function asuntoReporte(r: ReporteSemanal): string {
  const m = r.filas.filter((f) => f.veredicto === "mejor").length;
  const p = r.filas.filter((f) => f.veredicto === "peor").length;
  const cuenta = m + p ? ` · ${m} ${m === 1 ? "mejoró" : "mejoraron"}, ${p} ${p === 1 ? "empeoró" : "empeoraron"}` : "";
  return `Tu semana de salud: ${fechaCorta(r.lunes)} al ${fechaCorta(r.domingo)}${cuenta}`;
}

const ETIQUETA: Record<Veredicto, { texto: string; color: string }> = {
  mejor: { texto: "▲ Mejoró", color: "#1a7f37" },
  peor: { texto: "▼ Empeoró", color: "#c62828" },
  igual: { texto: "= Igual", color: "#57606a" },
  "sin-dato": { texto: "· Sin comparar", color: "#8c959f" },
};

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto plano (la otra parte del correo, para clientes sin HTML). */
export function textoReporte(r: ReporteSemanal, enlace?: string): string {
  const lineas = [asuntoReporte(r), "", ...frasesReporte(r), ""];
  for (const g of ORDEN_GRUPOS) {
    lineas.push(g.toUpperCase());
    for (const f of r.filas.filter((x) => x.grupo === g))
      lineas.push(`- ${f.nombre}: ${f.actual} (antes ${f.anterior}${f.cambio ? `, ${f.cambio}` : ""}) ${ETIQUETA[f.veredicto].texto}`);
    lineas.push("");
  }
  lineas.push(NOTA);
  if (enlace) lineas.push("", `Ver en el dashboard: ${enlace}`);
  return lineas.join("\n");
}

const NOTA =
  "Promedios por día de lunes a domingo contra la semana anterior; se compara con al menos 3 días de datos en cada una. " +
  "El ejercicio es la suma de la semana; para la meta de 150 min de la OMS un minuto vigoroso cuenta doble. Son cálculos propios con los datos del anillo, no los puntajes de Oura.";

/** Correo HTML: tablas y estilos en línea (lo que aguantan Gmail y Outlook). */
export function htmlReporte(r: ReporteSemanal, enlace?: string): string {
  const celda = "padding:6px 8px;border-top:1px solid #e5e7eb;font-size:14px;";
  const filas = ORDEN_GRUPOS.flatMap((g) => {
    const del = r.filas.filter((f) => f.grupo === g);
    if (!del.length) return [];
    return [
      `<tr><td colspan="3" style="padding:14px 8px 4px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#57606a;">${g}</td></tr>`,
      ...del.map((f) => {
        const e = ETIQUETA[f.veredicto];
        const dias = f.diasActual === null ? "" : ` <span style="color:#8c959f;font-size:12px;">(${f.diasActual} d)</span>`;
        return (
          `<tr><td style="${celda}color:#1f2328;">${escapar(f.nombre)}</td>` +
          `<td style="${celda}text-align:right;color:#1f2328;white-space:nowrap;"><b>${escapar(f.actual)}</b>${dias}` +
          `<br><span style="font-size:12px;font-weight:600;color:${e.color};">${e.texto}</span></td>` +
          `<td style="${celda}text-align:right;color:#57606a;white-space:nowrap;">${escapar(f.anterior)}${f.cambio ? `<br><span style="font-size:12px;">${escapar(f.cambio)}</span>` : ""}</td></tr>`
        );
      }),
    ];
  });
  const frases = frasesReporte(r)
    .map((f) => `<p style="margin:0 0 6px;font-size:15px;line-height:1.45;color:#1f2328;">${escapar(f)}</p>`)
    .join("");
  const boton = enlace
    ? `<p style="margin:20px 0 0;"><a href="${escapar(enlace)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;">Ver la semana en el dashboard</a></p>`
    : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(asuntoReporte(r))}</title></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;"><tr><td align="center" style="padding:12px 6px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="padding:20px 20px 8px;">
<p style="margin:0;font-size:12px;color:#57606a;">Salud · resumen semanal</p>
<h1 style="margin:4px 0 14px;font-size:20px;color:#1f2328;">Semana del ${fechaCorta(r.lunes)} al ${fechaCorta(r.domingo)}</h1>
${frases}
</td></tr>
<tr><td style="padding:0 6px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr><th style="padding:6px 8px;text-align:left;font-size:12px;color:#8c959f;font-weight:500;">Indicador</th><th style="padding:6px 8px;text-align:right;font-size:12px;color:#8c959f;font-weight:500;">Esta semana</th><th style="padding:6px 8px;text-align:right;font-size:12px;color:#8c959f;font-weight:500;">Anterior</th></tr>
${filas.join("\n")}
</table>
</td></tr>
<tr><td style="padding:8px 20px 20px;">
<p style="margin:0;font-size:12px;line-height:1.5;color:#8c959f;">${escapar(NOTA)}</p>
${boton}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
