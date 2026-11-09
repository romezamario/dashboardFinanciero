-- Batería del anillo (2026-11-09, Mario: "en el dashboard no veo el nivel de
-- batería del anillo"). La lee el colector de la laptop en cada lectura horaria
-- (`oura.exe info`) y la prueba de Bluefy cuando se usa. Cada lectura queda en
-- `oura_sincronizaciones` (para la gráfica de 48 h) y la última, en
-- `oura_anillos`. `origen` distingue quién leyó: 'laptop' o 'navegador'.
-- Las tablas ya tienen RLS por `user_id = (select auth.uid())` y grants a
-- authenticated/service_role sobre toda la tabla, que cubren estas columnas.

alter table salud.oura_sincronizaciones
  add column bateria_pct smallint check (bateria_pct between 0 and 100),
  add column bateria_leida_en timestamptz,
  add column cargando boolean,
  add column origen text not null default 'laptop' check (origen in ('laptop', 'navegador'));

alter table salud.oura_anillos
  add column bateria_pct smallint check (bateria_pct between 0 and 100),
  add column bateria_leida_en timestamptz,
  add column cargando boolean;

create index oura_sincronizaciones_bateria on salud.oura_sincronizaciones (user_id, bateria_leida_en)
  where bateria_pct is not null;
