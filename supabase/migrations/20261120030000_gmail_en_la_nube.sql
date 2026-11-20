-- Gastos por correo leídos desde la nube (2026-11-20, Mario: "desarrollar la
-- conexión con Gmail para que haga la extracción de correos que hace la
-- herramienta de escritorio").
--
-- La Edge Function `revisar-gmail` lee los avisos de compra de Banamex con el
-- permiso de solo lectura de Gmail que ya autorizó la app de escritorio y los
-- guarda en `gastos_correo` igual que `sync/gmail_gastos.py`. Corre cada 15
-- minutos (pg_cron + pg_net) y con el botón "Revisar ahora" del dashboard.
--
-- * privado.gmail_conexiones: el permiso de Gmail (client id/secret + refresh
--   token) que sube la app de escritorio con conectar_gmail(). El esquema
--   `privado` no lo expone la Data API; nadie lo lee desde el navegador.
-- * gmail_revisiones: bitácora de cada revisión (lo que el dashboard muestra).
-- * gmail_omitidos: avisos de la cuenta de débito ya vistos, que no son gastos
--   (como data/gastos_correo/debitos.json): solo el id, para no volver a
--   descargarlos. Sin acceso desde la API más que para service_role.
-- * privado.gmail_cron: URL de la función + secreto con que la llama pg_cron.
--   La URL la escribe db-migrate.yml (lleva el id del proyecto); el secreto se
--   genera aquí y nunca sale de la base.

create schema if not exists privado;

-- ------------------------------------------------------------- conexiones
create table privado.gmail_conexiones (
  user_id uuid primary key references auth.users(id) on delete cascade,
  correo text,
  client_id text not null,
  client_secret text not null,
  refresh_token text not null,
  actualizado_en timestamptz not null default now()
);
alter table privado.gmail_conexiones enable row level security;
revoke all on privado.gmail_conexiones from public, anon, authenticated;
grant select, insert, update, delete on privado.gmail_conexiones to service_role;

create function privado.conectar_gmail(p_client_id text, p_client_secret text, p_refresh_token text, p_correo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión.' using errcode = '42501';
  end if;
  if coalesce(p_client_id, '') = '' or coalesce(p_client_secret, '') = '' or coalesce(p_refresh_token, '') = '' then
    raise exception 'Faltan datos del permiso de Gmail.' using errcode = '22023';
  end if;
  insert into privado.gmail_conexiones (user_id, correo, client_id, client_secret, refresh_token, actualizado_en)
  values ((select auth.uid()), p_correo, p_client_id, p_client_secret, p_refresh_token, now())
  on conflict (user_id) do update set
    correo = excluded.correo,
    client_id = excluded.client_id,
    client_secret = excluded.client_secret,
    refresh_token = excluded.refresh_token,
    actualizado_en = case
      when privado.gmail_conexiones.refresh_token is distinct from excluded.refresh_token then now()
      else privado.gmail_conexiones.actualizado_en
    end;
end;
$$;

create function privado.desconectar_gmail()
returns void
language sql
volatile
security definer
set search_path = ''
as $$ delete from privado.gmail_conexiones where user_id = (select auth.uid()); $$;

-- Lo que el dashboard puede saber de la conexión (nunca el permiso en sí).
create function privado.estado_conexion_gmail()
returns table (conectada boolean, correo text, actualizado_en timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select true, c.correo, c.actualizado_en
  from privado.gmail_conexiones c
  where c.user_id = (select public.usuario_efectivo());
$$;

-- Solo la Edge Function (service_role).
create function privado.conexiones_gmail()
returns table (user_id uuid, correo text, client_id text, client_secret text, refresh_token text)
language sql
stable
security definer
set search_path = ''
as $$ select user_id, correo, client_id, client_secret, refresh_token from privado.gmail_conexiones; $$;

revoke all on function privado.conectar_gmail(text, text, text, text) from public, anon;
revoke all on function privado.desconectar_gmail() from public, anon;
revoke all on function privado.estado_conexion_gmail() from public, anon;
revoke all on function privado.conexiones_gmail() from public, anon, authenticated;
grant execute on function privado.conectar_gmail(text, text, text, text) to authenticated, service_role;
grant execute on function privado.desconectar_gmail() to authenticated, service_role;
grant execute on function privado.estado_conexion_gmail() to authenticated, service_role;
grant execute on function privado.conexiones_gmail() to service_role;

-- Envolturas SECURITY INVOKER en public (lo que ve supabase.rpc).
create function public.conectar_gmail(p_client_id text, p_client_secret text, p_refresh_token text, p_correo text default null)
returns void language sql volatile security invoker set search_path = ''
as $$ select privado.conectar_gmail(p_client_id, p_client_secret, p_refresh_token, p_correo); $$;
create function public.desconectar_gmail()
returns void language sql volatile security invoker set search_path = ''
as $$ select privado.desconectar_gmail(); $$;
create function public.estado_conexion_gmail()
returns table (conectada boolean, correo text, actualizado_en timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from privado.estado_conexion_gmail(); $$;
create function public.conexiones_gmail()
returns table (user_id uuid, correo text, client_id text, client_secret text, refresh_token text)
language sql stable security invoker set search_path = ''
as $$ select * from privado.conexiones_gmail(); $$;

revoke all on function public.conectar_gmail(text, text, text, text) from public, anon;
revoke all on function public.desconectar_gmail() from public, anon;
revoke all on function public.estado_conexion_gmail() from public, anon;
revoke all on function public.conexiones_gmail() from public, anon, authenticated;
grant execute on function public.conectar_gmail(text, text, text, text) to authenticated, service_role;
grant execute on function public.desconectar_gmail() to authenticated, service_role;
grant execute on function public.estado_conexion_gmail() to authenticated, service_role;
grant execute on function public.conexiones_gmail() to service_role;

-- -------------------------------------------------------------- bitácora
create table public.gmail_revisiones (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  empezo_en timestamptz not null default now(),
  duracion_ms integer,
  origen text not null check (origen in ('programada', 'manual')),
  resultado text not null check (resultado in ('ok', 'permiso_invalido', 'limite', 'sin_reglas', 'error')),
  mensaje text,
  avisos integer not null default 0,          -- avisos de compra en la ventana
  nuevos integer not null default 0,          -- descargados y guardados en esta revisión
  recategorizados integer not null default 0, -- gastos cuya categoría cambió con las reglas
  debitos integer not null default 0,         -- avisos de la cuenta de débito (no son gastos)
  ilegibles text[] not null default '{}',     -- ids de Gmail que no se pudieron leer
  sin_categoria text[] not null default '{}', -- establecimientos sin regla
  codigos_sin_confirmar text[] not null default '{}',
  reglas_huella text                           -- sha256 de las reglas aplicadas
);
create index gmail_revisiones_usuario_fecha on public.gmail_revisiones (user_id, empezo_en desc);
alter table public.gmail_revisiones enable row level security;
create policy "gmail_revisiones_select_own" on public.gmail_revisiones
  for select to authenticated using (user_id = (select public.usuario_efectivo()));
grant select on public.gmail_revisiones to authenticated;
grant all on public.gmail_revisiones to service_role;

-- ------------------------------------------------- avisos que no son gastos
create table public.gmail_omitidos (
  user_id uuid not null references auth.users(id) on delete cascade,
  mensaje_id text not null,
  tipo text not null check (tipo in ('debito')),
  visto_en timestamptz not null default now(),
  primary key (user_id, mensaje_id)
);
alter table public.gmail_omitidos enable row level security;
create policy "gmail_omitidos_sin_acceso" on public.gmail_omitidos
  for all to anon, authenticated using (false) with check (false);
revoke all on public.gmail_omitidos from anon, authenticated;
grant all on public.gmail_omitidos to service_role;

-- ----------------------------------------------------------- programación
create table privado.gmail_cron (
  id boolean primary key default true check (id),
  url text,
  secreto text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);
alter table privado.gmail_cron enable row level security;
revoke all on privado.gmail_cron from public, anon, authenticated;
insert into privado.gmail_cron default values;

create function privado.validar_cron_gmail(p_secreto text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from privado.gmail_cron where secreto = p_secreto and p_secreto <> ''); $$;
revoke all on function privado.validar_cron_gmail(text) from public, anon, authenticated;
grant execute on function privado.validar_cron_gmail(text) to service_role;

create function public.validar_cron_gmail(p_secreto text)
returns boolean language sql stable security invoker set search_path = ''
as $$ select privado.validar_cron_gmail(p_secreto); $$;
revoke all on function public.validar_cron_gmail(text) from public, anon, authenticated;
grant execute on function public.validar_cron_gmail(text) to service_role;

-- Lo que corre pg_cron: llama a la función solo si ya hay URL y alguien
-- conectó su Gmail.
create function privado.disparar_revision_gmail()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select url, secreto into c from privado.gmail_cron;
  if c.url is null or not exists (select 1 from privado.gmail_conexiones) then
    return;
  end if;
  perform net.http_post(
    url := c.url,
    body := '{"origen": "programada"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secreto', c.secreto),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function privado.disparar_revision_gmail() from public, anon, authenticated;

-- pg_cron y pg_net existen en Supabase; el Postgres de las pruebas de CI no
-- los tiene, así que ahí solo se salta la programación.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('revisar-gmail', '*/15 * * * *', 'select privado.disparar_revision_gmail()');
  end if;
end;
$$;
