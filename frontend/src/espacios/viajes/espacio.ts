// Subproyecto "Viajes" (repo romezamario/GestionViajes, la "Bitácora de
// viajes"). Aquí solo se publica su resumen, de solo lectura: lo lee
// /api/viajes (functions/api/viajes). Ver "Subproyectos" en CLAUDE.md.
import type { ManifiestoEspacio } from "../../lib/espacios";

const espacio: ManifiestoEspacio = {
  id: "viajes",
  nombre: "Viajes",
  descripcion: "Próximos viajes, itinerario de hoy, alojamientos y tickets.",
  orden: 30,
  icono: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m15.5 8.5-2 5-5 2 2-5 5-2Z"],
  // Datos personales y /api es solo del dueño: los invitados no lo ven.
  soloDueno: true,
  cargar: () => import("./Vista"),
};

export default espacio;
