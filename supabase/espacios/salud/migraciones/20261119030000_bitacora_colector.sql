-- Salud (2026-11-19, Mario: panel con el estado del colector de la laptop).
-- Desde el colector v6 (repo oura, colector/subir_oura.py) TODA corrida horaria
-- deja una fila en oura_sincronizaciones, también las que fallan, con:
--   resultado          ok | sin_anillo | conexion_cortada | error
--   codigo             código de salida del colector (0, 2, 3, otro)
--   mensaje            por qué falló (≤ 300 caracteres)
--   eventos_nuevos     eventos que bajó del anillo en esa corrida
--   ultimo_evento_unix hasta qué momento hay datos del anillo en la laptop
--   duracion_s         cuánto tardó la corrida
-- Las filas viejas quedan con resultado null (antes solo se anotaban las
-- buenas). RLS y grants de la tabla ya cubren estas columnas.

alter table salud.oura_sincronizaciones
  add column resultado text check (resultado in ('ok', 'sin_anillo', 'conexion_cortada', 'error')),
  add column codigo smallint,
  add column mensaje text check (length(mensaje) <= 300),
  add column eventos_nuevos integer check (eventos_nuevos >= 0),
  add column ultimo_evento_unix bigint,
  add column duracion_s real check (duracion_s >= 0);
