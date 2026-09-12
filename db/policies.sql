-- Políticas de RLS: cada operación queda restringida a las filas
-- cuyo user_id coincide con el usuario autenticado actual.
-- `bancos` es catálogo compartido y no lleva RLS (ver schema.sql).

-- cuentas
create policy "cuentas_select_own" on cuentas
  for select using (user_id = auth.uid());

create policy "cuentas_insert_own" on cuentas
  for insert with check (user_id = auth.uid());

create policy "cuentas_update_own" on cuentas
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "cuentas_delete_own" on cuentas
  for delete using (user_id = auth.uid());

-- categorias
create policy "categorias_select_own" on categorias
  for select using (user_id = auth.uid());

create policy "categorias_insert_own" on categorias
  for insert with check (user_id = auth.uid());

create policy "categorias_update_own" on categorias
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "categorias_delete_own" on categorias
  for delete using (user_id = auth.uid());

-- documentos
create policy "documentos_select_own" on documentos
  for select using (user_id = auth.uid());

create policy "documentos_insert_own" on documentos
  for insert with check (user_id = auth.uid());

create policy "documentos_update_own" on documentos
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "documentos_delete_own" on documentos
  for delete using (user_id = auth.uid());

-- transacciones
create policy "transacciones_select_own" on transacciones
  for select using (user_id = auth.uid());

create policy "transacciones_insert_own" on transacciones
  for insert with check (user_id = auth.uid());

create policy "transacciones_update_own" on transacciones
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "transacciones_delete_own" on transacciones
  for delete using (user_id = auth.uid());
