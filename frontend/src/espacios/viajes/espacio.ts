// Subproyecto "Viajes": todavía sin vista (sale en "Próximamente"). Cuando
// tenga una, agrega `cargar: () => import("./Vista")`. Ver "Subproyectos" en CLAUDE.md.
import type { ManifiestoEspacio } from "../../lib/espacios";

const espacio: ManifiestoEspacio = {
  id: "viajes",
  nombre: "Viajes",
  descripcion: "Planes, itinerarios y presupuestos de viaje.",
  orden: 30,
  icono: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m15.5 8.5-2 5-5 2 2-5 5-2Z"],
};

export default espacio;
