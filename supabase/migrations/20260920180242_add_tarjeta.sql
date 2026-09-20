-- Distingue qué tarjeta (Titular/Adicional/Digital) generó una transacción,
-- en estados de cuenta que agrupan movimientos por tarjeta dentro del mismo
-- documento (ej. una TDC con tarjetas adicionales). Columna de texto simple,
-- sin catálogo propio ni FK -- mismo patrón que transacciones.comercio,
-- justificado igual: es un conjunto chico y fijo de valores por documento,
-- no algo que necesite gestión propia como categorias.
alter table transacciones add column tarjeta text;
