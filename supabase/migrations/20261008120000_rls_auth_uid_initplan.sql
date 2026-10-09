-- RLS: `(select auth.uid())` en vez de `auth.uid()` en cada política.
--
-- Escrito como `user_id = auth.uid()`, Postgres puede evaluar la función una
-- vez POR FILA; envuelto en un subselect se evalúa una sola vez por consulta
-- (initPlan) y se compara contra una constante. Es la recomendación de
-- Supabase (su asesor de rendimiento lo marca como "auth_rls_initplan") y
-- se nota en las lecturas grandes del dashboard (todo el historial de
-- transacciones / gastos_correo). Mismo resultado de seguridad: solo cambia
-- cuándo se calcula el uid. `alter policy` las cambia en su lugar, sin un
-- instante en que la tabla quede sin política.

-- cuentas
alter policy "cuentas_select_own" on cuentas using (user_id = (select auth.uid()));
alter policy "cuentas_insert_own" on cuentas with check (user_id = (select auth.uid()));
alter policy "cuentas_update_own" on cuentas
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "cuentas_delete_own" on cuentas using (user_id = (select auth.uid()));

-- categorias
alter policy "categorias_select_own" on categorias using (user_id = (select auth.uid()));
alter policy "categorias_insert_own" on categorias with check (user_id = (select auth.uid()));
alter policy "categorias_update_own" on categorias
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "categorias_delete_own" on categorias using (user_id = (select auth.uid()));

-- documentos
alter policy "documentos_select_own" on documentos using (user_id = (select auth.uid()));
alter policy "documentos_insert_own" on documentos with check (user_id = (select auth.uid()));
alter policy "documentos_update_own" on documentos
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "documentos_delete_own" on documentos using (user_id = (select auth.uid()));

-- transacciones
alter policy "transacciones_select_own" on transacciones using (user_id = (select auth.uid()));
alter policy "transacciones_insert_own" on transacciones with check (user_id = (select auth.uid()));
alter policy "transacciones_update_own" on transacciones
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "transacciones_delete_own" on transacciones using (user_id = (select auth.uid()));

-- eventos
alter policy "eventos_select_own" on eventos using (user_id = (select auth.uid()));
alter policy "eventos_insert_own" on eventos with check (user_id = (select auth.uid()));
alter policy "eventos_update_own" on eventos
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "eventos_delete_own" on eventos using (user_id = (select auth.uid()));

-- gastos_correo
alter policy "gastos_correo_select_own" on gastos_correo using (user_id = (select auth.uid()));
alter policy "gastos_correo_insert_own" on gastos_correo with check (user_id = (select auth.uid()));
alter policy "gastos_correo_update_own" on gastos_correo
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "gastos_correo_delete_own" on gastos_correo using (user_id = (select auth.uid()));
