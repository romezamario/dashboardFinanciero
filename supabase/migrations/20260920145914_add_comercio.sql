-- Comercio (ej. "Televia") de una transacción, separado de su categoría
-- (ej. "Transporte") -- útil sobre todo para tarjeta de crédito, donde la
-- descripción cruda mezcla comercio + referencia. Columna de texto simple,
-- sin catálogo propio ni FK (a diferencia de categorias): se asigna por la
-- misma regla de palabra clave que asigna la categoría, ver
-- transform/categorizador.py.
alter table transacciones add column comercio text;
