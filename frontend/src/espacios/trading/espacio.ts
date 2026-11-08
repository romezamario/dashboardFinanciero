// Subproyecto "Trading automatizado" (repo privado romezamario/trading-agent).
// Aquí solo se publica su sección; ver "Subproyectos" en CLAUDE.md.
import type { ManifiestoEspacio } from "../../lib/espacios";

const espacio: ManifiestoEspacio = {
  id: "trading",
  nombre: "Trading",
  descripcion: "Análisis técnico de QQQ/TQQQ, macro de EE.UU. y el agente de trading.",
  orden: 10,
  icono: ["M3 17l5-5 4 4 8-8", "M15 8h5v5"],
  // Igual que antes en Finanzas: los invitados no lo ven (y /api lo bloquea).
  soloDueno: true,
  cargar: () => import("./Vista"),
};

export default espacio;
