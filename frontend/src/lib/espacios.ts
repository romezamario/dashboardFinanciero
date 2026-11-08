// Página de inicio del dashboard personal (Mario, 2026-11-08: "evolucionar el
// dashboard financiero a un dashboard personal"). Cada categoría es un
// "espacio". Finanzas es el tablero de siempre; los demás son SUBPROYECTOS que
// se trabajan en paralelo (Trading automatizado, Oura/Salud, Viajes…) y
// publican aquí sin pisarse: cada uno vive en su propia carpeta
// `src/espacios/<id>/` con un `espacio.ts` que se registra solo (este archivo
// los descubre con import.meta.glob, nadie tiene que editar una lista común).
// Sin enrutador: el hash de la URL decide cuál se ve, así el botón Atrás
// funciona. Solo edición personal: la de clientes entra directo a Finanzas.

import type { ComponentType } from "react";

/** Lo que recibe la vista de un espacio. Dibuja su página completa; para el
 * encabezado común ("← Inicio", nombre, tema, salir) usa `MarcoEspacio`. */
export interface PropsEspacio {
  onIrAInicio: () => void;
}

/** Lo que exporta (por default) `src/espacios/<id>/espacio.ts`. Debe ser un
 * archivo ligero: la vista se carga aparte, con `cargar`, en su propio chunk. */
export interface ManifiestoEspacio {
  /** Igual al nombre de la carpeta; también es el hash (#<id>). Minúsculas, sin acentos. */
  id: string;
  nombre: string;
  /** Una línea para la tarjeta del inicio. */
  descripcion: string;
  /** Posición en el inicio (menor = antes). Finanzas es 0. */
  orden: number;
  /** Trazos SVG (atributo `d` de cada <path>) en una caja de 24×24, línea de
   * 1.75 sin relleno. Vacío = ícono genérico. */
  icono?: readonly string[];
  /** Oculto para los invitados del acceso compartido (como Trading y la Wiki). */
  soloDueno?: boolean;
  /** La vista del espacio. Sin ella la tarjeta sale en "Próximamente". */
  cargar?: () => Promise<{ default: ComponentType<PropsEspacio> }>;
}

export type Espacio = string;

export interface DefinicionEspacio extends ManifiestoEspacio {
  disponible: boolean;
}

export const FINANZAS: DefinicionEspacio = {
  id: "finanzas",
  nombre: "Finanzas",
  descripcion: "Estados de cuenta, gastos recientes, tarjetas y eventos.",
  orden: 0,
  icono: ["M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1", "M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3", "M20 10h-4a2 2 0 0 0 0 4h4a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Z"],
  disponible: true,
};

const PATRON_ID = /^[a-z][a-z0-9-]*$/;

/** Arma la lista a partir de los manifiestos encontrados (separado para
 * probarlo sin import.meta.glob). Descarta ids inválidos o repetidos. */
export function armarEspacios(manifiestos: readonly ManifiestoEspacio[]): DefinicionEspacio[] {
  const vistos = new Set<string>([FINANZAS.id, "inicio"]);
  const lista: DefinicionEspacio[] = [FINANZAS];
  for (const m of manifiestos) {
    if (!PATRON_ID.test(m.id) || vistos.has(m.id)) {
      console.warn(`Espacio ignorado (id inválido o repetido): ${m.id}`);
      continue;
    }
    vistos.add(m.id);
    lista.push({ ...m, disponible: typeof m.cargar === "function" });
  }
  return lista.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
}

const modulos = import.meta.glob<{ default: ManifiestoEspacio }>("../espacios/*/espacio.ts", { eager: true });

export const ESPACIOS: readonly DefinicionEspacio[] = armarEspacios(Object.values(modulos).map((m) => m.default));

export function buscarEspacio(id: string): DefinicionEspacio | undefined {
  return ESPACIOS.find((e) => e.id === id);
}

/** Las anclas de la wiki (#wiki-<id>) viven dentro de Finanzas, así un enlace
 * a una sección de la wiki sigue abriendo el tablero. Un espacio "Próximamente"
 * o cualquier otro hash es el inicio. */
export function espacioDeHash(hash: string, espacios: readonly DefinicionEspacio[] = ESPACIOS): Espacio {
  const nombre = hash.replace(/^#/, "");
  if (nombre.startsWith("wiki-")) return "finanzas";
  return espacios.some((e) => e.id === nombre && e.disponible) ? nombre : "inicio";
}

export function hashDeEspacio(espacio: Espacio): string {
  return espacio === "inicio" ? "" : `#${espacio}`;
}
