-- Eventos (viajes, fiestas, etc.): catálogo reutilizable por usuario, igual
-- que categorias -- a diferencia de comercio/tarjeta (texto libre sin FK),
-- un evento necesita find-or-create por nombre exacto para que "Viaje a
-- Cancún" siempre apunte a la misma fila en vez de fragmentarse en
-- variantes de texto cada vez que alguien lo escribe.
create table eventos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  nombre text not null,
  unique (user_id, nombre)
);

alter table transacciones add column evento_id uuid references eventos(id);

create index idx_transacciones_evento on transacciones (user_id, evento_id);

alter table eventos enable row level security;

create policy "eventos_select_own" on eventos
  for select using (user_id = auth.uid());

create policy "eventos_insert_own" on eventos
  for insert with check (user_id = auth.uid());

create policy "eventos_update_own" on eventos
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "eventos_delete_own" on eventos
  for delete using (user_id = auth.uid());
