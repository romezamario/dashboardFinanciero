// Página de inicio del dashboard personal (Mario, 2026-11-08: "evolucionar el
// dashboard financiero a un dashboard personal"). Cada categoría es un
// "espacio"; todo lo que existía queda dentro de Finanzas. Sin enrutador: el
// hash de la URL decide cuál se ve, así el botón Atrás funciona. Solo edición
// personal: la de clientes entra directo al tablero de finanzas.

export type Espacio = "inicio" | "finanzas" | "salud" | "viajes" | "pendientes";

export interface DefinicionEspacio {
  id: Exclude<Espacio, "inicio">;
  nombre: string;
  descripcion: string;
  icono: string;
  /** false = tarjeta "Próximamente" (todavía no tiene contenido). */
  disponible: boolean;
}

export const ESPACIOS: readonly DefinicionEspacio[] = [
  {
    id: "finanzas",
    nombre: "Finanzas",
    descripcion: "Estados de cuenta, gastos recientes, tarjetas, eventos y trading.",
    icono: "💰",
    disponible: true,
  },
  {
    // Datos en el esquema `salud` de Supabase (supabase/espacios/salud), no en
    // `public`: cada espacio vive aparte.
    id: "salud",
    nombre: "Salud",
    descripcion: "Sueño, ritmo cardiaco, HRV y actividad del anillo Oura.",
    icono: "💍",
    disponible: true,
  },
  {
    id: "viajes",
    nombre: "Viajes",
    descripcion: "Planes, itinerarios y presupuestos de viaje.",
    icono: "✈️",
    disponible: false,
  },
  {
    id: "pendientes",
    nombre: "Pendientes",
    descripcion: "Tareas y recordatorios.",
    icono: "✅",
    disponible: false,
  },
];

/** Las anclas de la wiki (#wiki-<id>) viven dentro de Finanzas, así un enlace
 * a una sección de la wiki sigue abriendo el tablero. Cualquier otro hash es
 * el inicio. */
export function espacioDeHash(hash: string): Espacio {
  const nombre = hash.replace(/^#/, "");
  if (nombre.startsWith("wiki-")) return "finanzas";
  return ESPACIOS.some((e) => e.id === nombre) ? (nombre as Espacio) : "inicio";
}

export function hashDeEspacio(espacio: Espacio): string {
  return espacio === "inicio" ? "" : `#${espacio}`;
}
