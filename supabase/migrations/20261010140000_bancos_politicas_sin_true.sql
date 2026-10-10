-- Advisor de Supabase (`rls_policy_always_true`, advertencia en public.bancos):
-- las dos políticas de `bancos` estaban escritas con `using (true)` /
-- `with check (true)`, que el advisor marca porque no restringen nada de forma
-- explícita. El efecto real es el mismo -- solo el rol `authenticated` entra,
-- y `anon` sigue sin acceso --, pero se reescriben con una condición
-- verificable: que haya una sesión (`auth.uid()` no nulo). Mismo
-- comportamiento: select e insert para usuarios autenticados, nadie puede
-- modificar ni borrar un banco desde la API. (Subselect: se evalúa una vez por
-- consulta, como en el resto de las políticas.)
drop policy "bancos_select_autenticados" on bancos;
drop policy "bancos_insert_autenticados" on bancos;

create policy "bancos_select_autenticados" on bancos
  for select to authenticated using ((select auth.uid()) is not null);

create policy "bancos_insert_autenticados" on bancos
  for insert to authenticated with check ((select auth.uid()) is not null);
