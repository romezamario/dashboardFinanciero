-- Gastos de correo: la escritura pasa a hacerse con la sesión del usuario
-- (SUPABASE_EMAIL/SUPABASE_PASSWORD, como el sincronizador de estados de
-- cuenta), no con un secreto aparte.
--
-- 20261004210000_add_gastos_correo.sql pensaba en una tarea programada en la
-- nube sin la contraseña del usuario, que subía con la clave anon + un secreto
-- (función `ingestar_gastos_correo` + tabla `ingesta_correo`). La subida corre
-- en la app de escritorio, en la laptop donde la contraseña ya vive en .env,
-- así que el usuario decidió (2026-10-04) usar su propia sesión: RLS aplica
-- igual que en el resto de las tablas y no hay un secreto más que configurar.

create policy "gastos_correo_insert_own" on gastos_correo
  for insert with check (user_id = auth.uid());
create policy "gastos_correo_update_own" on gastos_correo
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "gastos_correo_delete_own" on gastos_correo
  for delete using (user_id = auth.uid());

-- Ya sin uso: la función se podía invocar con la clave anon (sin sesión),
-- protegida solo por el secreto; mejor que no quede expuesta.
drop function if exists ingestar_gastos_correo(text, jsonb);
drop table if exists ingesta_correo;
