// Planes de FinanzasPersonales tal como se anuncian en la landing page
// (decididos el 2026-10-11 en el plan de suscripciones). Esto es solo lo que
// se MUESTRA: el plan efectivo de cada usuario lo decide la base de datos
// (tablas planes/suscripciones y mi_plan(), fase 3), nunca el frontend. Los
// precios de la tabla planes tienen que coincidir (precios.test.ts lo revisa).

export type IdPlan = "gratis" | "basico" | "pro";
export type Periodo = "anual" | "mensual";

export interface Plan {
  id: IdPlan;
  nombre: string;
  descripcion: string;
  /** Pesos MXN al mes; 0 = gratis. */
  precioMensual: number;
  /** Pesos MXN al año (10 meses por 12); null = no hay plan anual. */
  precioAnual: number | null;
  destacado: boolean;
  incluye: string[];
}

export const PLANES: Plan[] = [
  {
    id: "gratis",
    nombre: "Gratis",
    descripcion: "Para probar con tu cuenta principal.",
    precioMensual: 0,
    precioAnual: null,
    destacado: false,
    incluye: [
      "1 cuenta o tarjeta",
      "Últimos 3 meses de historial",
      "Carga de estados de cuenta",
      "Resumen: tasa de ahorro, ingresos y gastos",
      "Hasta 20 reglas de categorización",
    ],
  },
  {
    id: "basico",
    nombre: "Básico",
    descripcion: "Todo el análisis de tus gastos.",
    precioMensual: 29,
    precioAnual: 299,
    destacado: true,
    incluye: [
      "Hasta 5 cuentas o tarjetas",
      "Historial completo",
      "Reglas de categorización ilimitadas",
      "Gasto hormiga, recurrentes y categorías al alza",
      "Comparativo de tarjetas de crédito",
      "Eventos: viajes y proyectos aparte",
      "Calendario de gastos con meta diaria",
      "Exportar a Excel",
    ],
  },
  {
    id: "pro",
    nombre: "Pro",
    descripcion: "Ayudas automáticas para no perder nada.",
    precioMensual: 59,
    precioAnual: 599,
    destacado: false,
    incluye: [
      "Todo lo de Básico",
      "Cuentas y tarjetas ilimitadas",
      "Alertas: cargos duplicados, cambios de precio y cargos inusuales",
      "Sugerencias de reglas con IA (con cupo mensual)",
    ],
  },
];

/** Días de prueba de Básico al registrarse, sin tarjeta. */
export const DIAS_PRUEBA = 14;

/** Lo que cuesta al mes un plan pagado en el periodo elegido (el anual, prorrateado). */
export function precioPorMes(plan: Plan, periodo: Periodo): number {
  if (periodo === "anual" && plan.precioAnual !== null) return plan.precioAnual / 12;
  return plan.precioMensual;
}

/** Pesos que se ahorran al año pagando anual en vez de 12 mensualidades. */
export function ahorroAnual(plan: Plan): number {
  if (plan.precioAnual === null) return 0;
  return plan.precioMensual * 12 - plan.precioAnual;
}
