-- Salud (2026-11-14, Mario): aviso cuando el colector de la laptop está
-- desactualizado y vista de viaje.
--
-- 1) Cada subida de la laptop anota la versión del colector, si quedó al día
--    con el repo (se actualiza solo con colector/actualizar_colector.py del
--    repo oura) y la zona horaria de la laptop en ese momento (minutos vs.
--    UTC; CDMX = -360, Las Vegas = -480 o -420 en horario de verano).
-- 2) `viajes`: los viajes que Mario marca en el dashboard para ver cómo le
--    afectan (sueño, HRV, estrés antes / durante / después).
--
-- RLS como el resto del esquema: solo el dueño (`auth.uid()`, no
-- `usuario_efectivo()`: los invitados de Finanzas no ven datos de salud).

alter table salud.oura_sincronizaciones
  add column version_colector smallint check (version_colector > 0),
  add column colector_commit text check (colector_commit ~ '^[0-9a-f]{7,40}$'),
  add column colector_al_dia boolean,
  add column actualizacion_error text check (length(actualizacion_error) <= 300),
  add column utc_offset_min smallint check (utc_offset_min between -840 and 840);

create index oura_sincronizaciones_laptop on salud.oura_sincronizaciones (user_id, subida_en desc)
  where origen = 'laptop';

create table salud.viajes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lugar text not null check (length(btrim(lugar)) between 1 and 80),
  desde date not null,
  -- null = sigue en curso.
  hasta date check (hasta is null or hasta >= desde),
  -- Zona del destino en minutos vs. UTC (opcional; si falta, el dashboard usa
  -- la que reportó la laptop esos días).
  utc_offset_min smallint check (utc_offset_min between -840 and 840),
  creado_en timestamptz not null default now()
);
create index viajes_usuario on salud.viajes (user_id, desde);

-- Desde 2026-10-30 Supabase ya no da permisos automáticos a tablas nuevas.
grant select, insert, update, delete on salud.viajes to authenticated;
grant all on salud.viajes to service_role;
grant usage, select on all sequences in schema salud to authenticated, service_role;

alter table salud.viajes enable row level security;
create policy "viajes_propios" on salud.viajes
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
