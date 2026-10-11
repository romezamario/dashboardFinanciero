-- Preferencias del usuario que deben quedarse guardadas (y verse igual en el
-- teléfono y en la computadora): por ahora la meta de gasto diario de
-- "Gastos recientes" (clave `meta_gasto_diario`, valor = número en pesos).
-- Una fila por (usuario, clave); el valor es jsonb para no crear una columna
-- por cada preferencia futura.
create table preferencias (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  clave text not null,
  valor jsonb not null,
  actualizado_en timestamptz not null default now(),
  primary key (user_id, clave)
);

alter table preferencias enable row level security;

create policy "preferencias_select_own" on preferencias
  for select using (user_id = (select auth.uid()));
create policy "preferencias_insert_own" on preferencias
  for insert with check (user_id = (select auth.uid()));
create policy "preferencias_update_own" on preferencias
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "preferencias_delete_own" on preferencias
  for delete using (user_id = (select auth.uid()));

-- Desde el 30 de oct. Supabase no da acceso a la Data API a las tablas nuevas
-- por sí solo. Solo `authenticated` (el usuario con sesión) la usa; `anon` no
-- tiene nada que hacer aquí, y RLS limita cada fila a su dueño.
grant select, insert, update, delete on preferencias to authenticated;
grant all on preferencias to service_role;
