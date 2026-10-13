-- Precios anuales nuevos (decisión de Mario, 2026-10-13): Básico 299 y Pro 599
-- MXN (antes 290/590). Mismos valores que frontend/src/lib/planes.ts; las
-- suscripciones ya creadas conservan su monto.
insert into planes (id, nombre, precio_mensual, precio_anual, max_cuentas, meses_historial, max_reglas, orden) values
  ('basico', 'Básico', 29, 299, 5, null, null, 1),
  ('pro', 'Pro', 59, 599, null, null, null, 2)
on conflict (id) do update set precio_anual = excluded.precio_anual;
