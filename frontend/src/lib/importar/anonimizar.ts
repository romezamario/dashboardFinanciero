// Port de parsers/_anonimizador.py: conserva la ESTRUCTURA de un estado de
// cuenta (formato de fechas y montos, columnas, longitud de palabras) sin los
// datos reales, para mandar una muestra de un banco que todavía no sabemos
// leer. Cada dígito → "0", cada letra → "X"/"x", salvo el vocabulario
// bancario genérico (no es información de nadie). Mismo vocabulario que la
// app de escritorio; si cambia uno, cambia el otro.

const VOCABULARIO_BANCARIO: ReadonlySet<string> = new Set([
  "FECHA", "CONCEPTO", "DESCRIPCION", "RETIROS", "RETIRO", "DEPOSITOS",
  "DEPOSITO", "SALDO", "ANTERIOR", "ACTUAL", "CARGO", "CARGOS", "ABONO",
  "ABONOS", "PAGO", "PAGOS", "RECIBIDO", "ENVIADO", "TRANSFERENCIA",
  "SPEI", "INTERBANCARIO", "REF", "REFERENCIA", "RASTREO", "CLAVE",
  "CUENTA", "CTA", "ORDENANTE", "BENEFICIARIO", "INSTITUCION",
  "VERIFICADO", "DATO", "COMISION", "EXENCION", "COBRO", "MANEJO",
  "PERIODO", "IMPORTE", "INVERSION", "MISMO", "DIA", "CREDITO", "NOMINA",
  "TC", "SU", "A", "DE", "DEL", "POR", "ORDEN", "AL", "EN", "CON", "SIN",
  "NO", "SI", "ESTADO", "MONEDA", "NACIONAL", "PESOS", "DETALLE",
  "OPERACIONES", "IVA", "ISR", "RETENCION", "COMPRA", "VENTA",
  "SERVICIO", "SUCURSAL", "CAJERO", "TARJETA", "DEBITO", "ATM",
  "PRIORITY", "TOTAL", "SUBTOTAL", "RESUMEN", "MOVIMIENTOS",
  "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT",
  "NOV", "DIC",
  "BBVA", "BANAMEX", "SANTANDER", "BANORTE", "SCOTIABANK", "HSBC",
  "INBURSA", "AZTECA", "MEXICO",
]);

const PATRON_PALABRA = /[A-Za-zÁÉÍÓÚÑÜáéíóúñü]+/g;

export function anonimizar(texto: string): string {
  return texto
    .replace(/\d/g, "0")
    .replace(PATRON_PALABRA, (palabra) =>
      VOCABULARIO_BANCARIO.has(palabra.toUpperCase())
        ? palabra
        : [...palabra].map((c) => (c === c.toLowerCase() ? "x" : "X")).join("")
    );
}
