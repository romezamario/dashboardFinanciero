// Subproyecto "Oura" (repo privado romezamario/oura, que sube los datos con
// colector/subir_oura.py). Vista, gráficas y lógica en esta carpeta; sus
// tablas, en el esquema `salud` (supabase/espacios/salud). Ver "Subprojects"
// en CLAUDE.md.
import type { ManifiestoEspacio } from "../../lib/espacios";

const espacio: ManifiestoEspacio = {
  id: "salud",
  nombre: "Salud",
  descripcion: "Sueño, ritmo cardiaco, HRV y actividad del anillo Oura.",
  orden: 20,
  icono: ["M3 12h4l2-5 4 10 2-5h6"],
  cargar: () => import("./Vista"),
};

export default espacio;
