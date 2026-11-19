// Reporte semanal de salud por correo (Mario, 2026-11-18). Lo corre
// .github/workflows/reporte-salud.yml cada lunes 8:00 de Ciudad de México,
// ya empaquetado por scripts/vite.reporte-salud.ts (node dist-reporte/reporte.mjs).
//
// Lee salud.resumen_ligero y salud.ejercicio_etiquetas con la API de
// administración de Supabase (el mismo token que ya usan mantener-activo y las
// migraciones de espacios; no hace falta guardar la contraseña de nadie), arma
// el reporte con las funciones de la pestaña Semana y lo manda por SMTP.
//
// El repo es público: NUNCA imprimir datos de salud ni correos en el log.
//
// Variables: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID, SMTP_USUARIO,
// SMTP_CONTRASENA (contraseña de aplicación de Gmail), y opcionales
// CORREO_REPORTE (destino; por omisión SMTP_USUARIO), SMTP_HOST (smtp.gmail.com),
// SMTP_PUERTO (465), URL_DASHBOARD, SALUD_USER_ID.
// Argumentos: --lunes=AAAA-MM-DD (otra semana), --vista-previa=archivo.html (no envía).
/// <reference types="node" />
import { writeFileSync } from "node:fs";
import { filaADia, restarDias } from "../salud";
import type { EtiquetaEjercicio } from "../ejercicio";
import { semanaParaResumir } from "../semanal";
import { armarReporte, asuntoReporte, htmlReporte, textoReporte } from "../reporteSemanal";
import { enviarSmtp } from "./correo";

/** CDMX no tiene horario de verano desde 2022. */
const OFFSET_CDMX_MIN = -360;
/** Historia que se baja antes del lunes: la recuperación se mide contra los 30
 * días previos y el estrés contra 14. */
const DIAS_HISTORIA = 45;

const arg = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1];

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable ${nombre}.`);
  return v;
}

async function sql<T>(consulta: string): Promise<T[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${requerida("SUPABASE_PROJECT_ID")}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requerida("SUPABASE_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: consulta }),
  });
  if (!r.ok) throw new Error(`Supabase respondió ${r.status} a la consulta.`);
  return (await r.json()) as T[];
}

const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  const hoy = new Date(Date.now() + OFFSET_CDMX_MIN * 60_000).toISOString().slice(0, 10);
  const lunes = arg("lunes") ?? semanaParaResumir(hoy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lunes)) throw new Error("--lunes debe ser AAAA-MM-DD.");
  const desde = restarDias(lunes, DIAS_HISTORIA);

  // El dueño de los datos de salud: SALUD_USER_ID o el que tenga más días.
  const usuario = process.env.SALUD_USER_ID
    ? literal(process.env.SALUD_USER_ID) + "::uuid"
    : "(select user_id from salud.resumen_diario group by user_id order by count(*) desc limit 1)";
  const [filas, etiquetas] = await Promise.all([
    sql<{ fecha: string; datos: Record<string, unknown> | null }>(
      `select fecha::text as fecha, datos - 'hr_horas' - 'temp_horas' as datos from salud.resumen_ligero
       where fuente = 'oura' and fecha >= ${literal(desde)} and user_id = ${usuario} order by fecha`,
    ),
    sql<EtiquetaEjercicio>(
      `select inicio::float8 as inicio, fin::float8 as fin, fecha::text as fecha, tipo, estado from salud.ejercicio_etiquetas
       where user_id = ${usuario}`,
    ).catch(() => [] as EtiquetaEjercicio[]),
  ]);
  const dias = filas.map((f) => filaADia(f as Parameters<typeof filaADia>[0]));
  const reporte = armarReporte(dias, etiquetas, lunes);
  const enlace = process.env.URL_DASHBOARD ? `${process.env.URL_DASHBOARD.replace(/\/?#.*$/, "").replace(/\/$/, "")}/#salud` : undefined;
  const html = htmlReporte(reporte, enlace);

  const vista = arg("vista-previa");
  if (vista) {
    writeFileSync(vista, html);
    console.log(`Vista previa guardada en ${vista}; no se envió nada.`);
    return;
  }
  const usuarioSmtp = requerida("SMTP_USUARIO");
  await enviarSmtp(
    {
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      puerto: Number(process.env.SMTP_PUERTO || 465),
      usuario: usuarioSmtp,
      contrasena: requerida("SMTP_CONTRASENA"),
    },
    { de: usuarioSmtp, para: process.env.CORREO_REPORTE || usuarioSmtp, asunto: asuntoReporte(reporte), texto: textoReporte(reporte, enlace), html },
  );
  console.log(`Reporte de la semana del ${lunes} enviado.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "Error desconocido.");
  process.exit(1);
});
