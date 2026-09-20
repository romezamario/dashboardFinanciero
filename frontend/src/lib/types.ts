// Los nombres de estos campos (categorias, documentos, cuentas, bancos)
// coinciden con los que devuelve PostgREST al anidar relaciones por nombre
// de tabla — así el resultado de la consulta no necesita un paso de
// reshape antes de usarse.
export interface Transaccion {
  id: string;
  fecha: string; // ISO date (YYYY-MM-DD)
  descripcion: string;
  // PostgREST serializa `numeric` como número JSON. Para *visualización*
  // (sumas/gráficas en el navegador, nunca escritura de vuelta a la BD) un
  // double de 64 bits es exacto de sobra a montos personales — la regla
  // "nunca float" del backend es para el pipeline de ingesta/almacenamiento,
  // no para sumar lo que ya está guardado como numeric en Postgres.
  monto: number;
  tipo: "cargo" | "abono";
  saldo: number | null;
  comercio: string | null;
  categorias: { nombre: string } | null;
  documentos: {
    cuentas: {
      alias: string;
      bancos: { nombre: string };
    };
  };
}
