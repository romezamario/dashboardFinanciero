-- Autorizar Gmail desde el dashboard (2026-11-20, Mario: "no quiero que la
-- autorización sea en desktop, también quiero que sea a través del dashboard
-- si es que expira").
--
-- La Edge Function `gmail-oauth` hace el flujo OAuth de Google con un cliente
-- "Aplicación web" (el de escritorio no acepta un redirect https) y guarda el
-- permiso aquí. Este archivo agrega:
--
-- * privado.gmail_conexiones.invalida: la marca revisar-gmail cuando Google
--   rechaza el permiso (venció o se revocó) y se borra al reconectar.
--   .origen: 'escritorio' (sync/gmail_nube.py) o 'dashboard' (gmail-oauth).
-- * conectar_gmail (la que usa la app de escritorio) ya NO reemplaza una
--   conexión válida con otro permiso: la app sube su token en cada
--   sincronización y podía pisar una conexión hecha desde el dashboard con un
--   token viejo. Solo la reemplaza si no hay conexión o está marcada inválida.
--   Ahora devuelve si guardó.
-- * privado.gmail_oauth_estados: el `state` de cada autorización en curso
--   (usuario + a dónde volver), de un solo uso y válido 15 minutos.
-- * RPC solo para service_role: guardar/tomar el state, guardar la conexión
--   del dashboard y marcar una conexión inválida/válida.

alter table privado.gmail_conexiones
  add column invalida boolean not null default false,
  add column origen text not null default 'escritorio' check (origen in ('escritorio', 'dashboard'));

-- ------------------------------------------- conectar_gmail (escritorio)
drop function public.conectar_gmail(text, text, text, text);
drop function privado.conectar_gmail(text, text, text, text);

create function privado.conectar_gmail(p_client_id text, p_client_secret text, p_refresh_token text, p_correo text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Inicia sesión.' using errcode = '42501';
  end if;
  if coalesce(p_client_id, '') = '' or coalesce(p_client_secret, '') = '' or coalesce(p_refresh_token, '') = '' then
    raise exception 'Faltan datos del permiso de Gmail.' using errcode = '22023';
  end if;
  -- Una conexión que funciona (p. ej. la autorizada desde el dashboard) no se
  -- reemplaza con otro permiso.
  if exists (
    select 1 from privado.gmail_conexiones c
    where c.user_id = uid and not c.invalida and c.refresh_token <> p_refresh_token
  ) then
    return false;
  end if;
  insert into privado.gmail_conexiones (user_id, correo, client_id, client_secret, refresh_token, actualizado_en, invalida, origen)
  values (uid, p_correo, p_client_id, p_client_secret, p_refresh_token, now(), false, 'escritorio')
  on conflict (user_id) do update set
    correo = coalesce(excluded.correo, privado.gmail_conexiones.correo),
    client_id = excluded.client_id,
    client_secret = excluded.client_secret,
    refresh_token = excluded.refresh_token,
    invalida = false,
    origen = excluded.origen,
    actualizado_en = case
      when privado.gmail_conexiones.refresh_token is distinct from excluded.refresh_token then now()
      else privado.gmail_conexiones.actualizado_en
    end;
  return true;
end;
$$;

create function public.conectar_gmail(p_client_id text, p_client_secret text, p_refresh_token text, p_correo text default null)
returns boolean language sql volatile security invoker set search_path = ''
as $$ select privado.conectar_gmail(p_client_id, p_client_secret, p_refresh_token, p_correo); $$;

revoke all on function privado.conectar_gmail(text, text, text, text) from public, anon;
revoke all on function public.conectar_gmail(text, text, text, text) from public, anon;
grant execute on function privado.conectar_gmail(text, text, text, text) to authenticated, service_role;
grant execute on function public.conectar_gmail(text, text, text, text) to authenticated, service_role;

-- ------------------------------------------------ estado (para el dashboard)
drop function public.estado_conexion_gmail();
drop function privado.estado_conexion_gmail();

create function privado.estado_conexion_gmail()
returns table (conectada boolean, correo text, actualizado_en timestamptz, invalida boolean, origen text)
language sql
stable
security definer
set search_path = ''
as $$
  select true, c.correo, c.actualizado_en, c.invalida, c.origen
  from privado.gmail_conexiones c
  where c.user_id = (select public.usuario_efectivo());
$$;

create function public.estado_conexion_gmail()
returns table (conectada boolean, correo text, actualizado_en timestamptz, invalida boolean, origen text)
language sql stable security invoker set search_path = ''
as $$ select * from privado.estado_conexion_gmail(); $$;

revoke all on function privado.estado_conexion_gmail() from public, anon;
revoke all on function public.estado_conexion_gmail() from public, anon;
grant execute on function privado.estado_conexion_gmail() to authenticated, service_role;
grant execute on function public.estado_conexion_gmail() to authenticated, service_role;

-- ------------------------------------- conexiones (para revisar-gmail)
drop function public.conexiones_gmail();
drop function privado.conexiones_gmail();

create function privado.conexiones_gmail()
returns table (user_id uuid, correo text, client_id text, client_secret text, refresh_token text, invalida boolean)
language sql
stable
security definer
set search_path = ''
as $$ select user_id, correo, client_id, client_secret, refresh_token, invalida from privado.gmail_conexiones; $$;

create function public.conexiones_gmail()
returns table (user_id uuid, correo text, client_id text, client_secret text, refresh_token text, invalida boolean)
language sql stable security invoker set search_path = ''
as $$ select * from privado.conexiones_gmail(); $$;

revoke all on function privado.conexiones_gmail() from public, anon, authenticated;
revoke all on function public.conexiones_gmail() from public, anon, authenticated;
grant execute on function privado.conexiones_gmail() to service_role;
grant execute on function public.conexiones_gmail() to service_role;

-- --------------------------------------------- autorización desde el dashboard
create table privado.gmail_oauth_estados (
  estado text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  volver text not null,
  creado_en timestamptz not null default now()
);
alter table privado.gmail_oauth_estados enable row level security;
revoke all on privado.gmail_oauth_estados from public, anon, authenticated;
grant select, insert, update, delete on privado.gmail_oauth_estados to service_role;

create function privado.guardar_estado_oauth_gmail(p_estado text, p_user_id uuid, p_volver text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if length(coalesce(p_estado, '')) < 32 then
    raise exception 'state inválido' using errcode = '22023';
  end if;
  delete from privado.gmail_oauth_estados where creado_en < now() - interval '15 minutes';
  insert into privado.gmail_oauth_estados (estado, user_id, volver) values (p_estado, p_user_id, p_volver);
end;
$$;

-- De un solo uso: lo borra al leerlo; vencido (> 15 min) no devuelve nada.
create function privado.tomar_estado_oauth_gmail(p_estado text)
returns table (user_id uuid, volver text)
language sql
volatile
security definer
set search_path = ''
as $$
  with tomado as (
    delete from privado.gmail_oauth_estados e where e.estado = p_estado
    returning e.user_id, e.volver, e.creado_en
  )
  select t.user_id, t.volver from tomado t where t.creado_en > now() - interval '15 minutes';
$$;

create function privado.guardar_conexion_gmail_web(p_user_id uuid, p_client_id text, p_client_secret text, p_refresh_token text, p_correo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(p_client_id, '') = '' or coalesce(p_client_secret, '') = '' or coalesce(p_refresh_token, '') = '' then
    raise exception 'Faltan datos del permiso de Gmail.' using errcode = '22023';
  end if;
  insert into privado.gmail_conexiones (user_id, correo, client_id, client_secret, refresh_token, actualizado_en, invalida, origen)
  values (p_user_id, p_correo, p_client_id, p_client_secret, p_refresh_token, now(), false, 'dashboard')
  on conflict (user_id) do update set
    correo = coalesce(excluded.correo, privado.gmail_conexiones.correo),
    client_id = excluded.client_id,
    client_secret = excluded.client_secret,
    refresh_token = excluded.refresh_token,
    invalida = false,
    origen = 'dashboard',
    actualizado_en = now();
end;
$$;

create function privado.marcar_gmail_invalido(p_user_id uuid, p_invalida boolean)
returns void
language sql
volatile
security definer
set search_path = ''
as $$ update privado.gmail_conexiones set invalida = p_invalida where user_id = p_user_id and invalida is distinct from p_invalida; $$;

create function public.guardar_estado_oauth_gmail(p_estado text, p_user_id uuid, p_volver text)
returns void language sql volatile security invoker set search_path = ''
as $$ select privado.guardar_estado_oauth_gmail(p_estado, p_user_id, p_volver); $$;
create function public.tomar_estado_oauth_gmail(p_estado text)
returns table (user_id uuid, volver text) language sql volatile security invoker set search_path = ''
as $$ select * from privado.tomar_estado_oauth_gmail(p_estado); $$;
create function public.guardar_conexion_gmail_web(p_user_id uuid, p_client_id text, p_client_secret text, p_refresh_token text, p_correo text)
returns void language sql volatile security invoker set search_path = ''
as $$ select privado.guardar_conexion_gmail_web(p_user_id, p_client_id, p_client_secret, p_refresh_token, p_correo); $$;
create function public.marcar_gmail_invalido(p_user_id uuid, p_invalida boolean)
returns void language sql volatile security invoker set search_path = ''
as $$ select privado.marcar_gmail_invalido(p_user_id, p_invalida); $$;

revoke all on function privado.guardar_estado_oauth_gmail(text, uuid, text) from public, anon, authenticated;
revoke all on function privado.tomar_estado_oauth_gmail(text) from public, anon, authenticated;
revoke all on function privado.guardar_conexion_gmail_web(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function privado.marcar_gmail_invalido(uuid, boolean) from public, anon, authenticated;
revoke all on function public.guardar_estado_oauth_gmail(text, uuid, text) from public, anon, authenticated;
revoke all on function public.tomar_estado_oauth_gmail(text) from public, anon, authenticated;
revoke all on function public.guardar_conexion_gmail_web(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.marcar_gmail_invalido(uuid, boolean) from public, anon, authenticated;
grant execute on function privado.guardar_estado_oauth_gmail(text, uuid, text) to service_role;
grant execute on function privado.tomar_estado_oauth_gmail(text) to service_role;
grant execute on function privado.guardar_conexion_gmail_web(uuid, text, text, text, text) to service_role;
grant execute on function privado.marcar_gmail_invalido(uuid, boolean) to service_role;
grant execute on function public.guardar_estado_oauth_gmail(text, uuid, text) to service_role;
grant execute on function public.tomar_estado_oauth_gmail(text) to service_role;
grant execute on function public.guardar_conexion_gmail_web(uuid, text, text, text, text) to service_role;
grant execute on function public.marcar_gmail_invalido(uuid, boolean) to service_role;
