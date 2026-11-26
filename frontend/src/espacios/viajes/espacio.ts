// Subproyecto "Viajes" (repo romezamario/GestionViajes, la "Bitácora de
// viajes"). La tarjeta abre la bitácora completa en /viajes/ (la copia el
// deploy, .github/scripts/incluir-viajes.sh). Ver "Subproyectos" en CLAUDE.md.
import type { ManifiestoEspacio } from "../../lib/espacios";

const espacio: ManifiestoEspacio = {
  id: "viajes",
  nombre: "Viajes",
  descripcion: "Bitácora de viajes: itinerario, alojamientos, tickets y lista.",
  orden: 30,
  icono: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m15.5 8.5-2 5-5 2 2-5 5-2Z"],
  // Datos personales: los invitados no lo ven.
  soloDueno: true,
  cargar: () => import("./Vista"),
};

export default espacio;
