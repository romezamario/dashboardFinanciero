-- Lo mínimo de Supabase para aplicar las migraciones en un Postgres vacío
-- (CI y pruebas locales): los roles de la Data API, el esquema `auth` con
-- `auth.users` y `auth.uid()` leyendo el usuario de la sesión, como hace
-- PostgREST con el JWT (`request.jwt.claim.sub`). No es Supabase: solo lo que
-- las políticas de RLS necesitan para comportarse igual.
-- Los roles son de todo el servidor: si ya existen (otra corrida), se reusan.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  -- Lo que el registro manda en `options.data` (supabase.auth.signUp).
  raw_user_meta_data jsonb not null default '{}'
);

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Como los proyectos creados antes del 30 de oct. de 2026: las tablas nuevas
-- de `public` quedan accesibles para los roles de la API (RLS decide filas).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
