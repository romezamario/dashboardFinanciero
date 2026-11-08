// Subproyecto "Oura" (repo privado romezamario/oura). Su vista y su lógica
// siguen en components/Salud.tsx y lib/salud.ts; sus tablas, en el esquema
// `salud` (supabase/espacios/salud). Ver "Subproyectos" en CLAUDE.md.
import type { ManifiestoEspacio } from "../../lib/espacios";

const espacio: ManifiestoEspacio = {
  id: "salud",
  nombre: "Salud",
  descripcion: "Sueño, ritmo cardiaco, HRV y actividad del anillo Oura.",
  orden: 20,
  icono: ["M3 12h4l2-5 4 10 2-5h6"],
  cargar: () => import("../../components/Salud").then((m) => ({ default: m.Salud })),
};

export default espacio;
