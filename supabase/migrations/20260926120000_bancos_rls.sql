-- `bancos` nació como catálogo compartido SIN RLS (ver schema.sql). En
-- Supabase eso significa que el rol `anon` -- cuya clave va pública en el
-- JavaScript del frontend -- podía insertar, renombrar o borrar bancos por
-- la API REST sin iniciar sesión (Cloudflare Access protege el sitio, no la
-- API de Supabase). Se activa RLS y solo se permite lo que el sistema de
-- verdad usa, y solo a usuarios autenticados:
--   - select: el frontend lee `bancos(nombre)` anidado en las transacciones,
--     y el sincronizador busca el banco por nombre (find-or-create).
--   - insert: el sincronizador crea el banco la primera vez que lo ve.
-- Sin políticas de update/delete: nadie puede modificar ni borrar un banco
-- desde la API (un banco mal escrito se corrige con una migración).
-- Sigue siendo un catálogo compartido (sin user_id), igual que antes.
alter table bancos enable row level security;

create policy "bancos_select_autenticados" on bancos
  for select to authenticated using (true);

create policy "bancos_insert_autenticados" on bancos
  for insert to authenticated with check (true);
