// Fechas "de hoy" en la zona del navegador -- NO en UTC: de noche en México,
// UTC ya va en el día (o el mes) siguiente. Una sola implementación para todo
// el tablero (antes había tres copias en promedios, metaDiaria, macro e
// indicadores).

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" de hoy (o de `hoy`). */
export function hoyIso(hoy: Date = new Date()): string {
  return `${hoy.getFullYear()}-${dosDigitos(hoy.getMonth() + 1)}-${dosDigitos(hoy.getDate())}`;
}

/** "YYYY-MM" del mes en curso (o del de `hoy`). */
export function mesActual(hoy: Date = new Date()): string {
  return `${hoy.getFullYear()}-${dosDigitos(hoy.getMonth() + 1)}`;
}
