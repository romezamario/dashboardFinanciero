-- Alertas del Security Advisor de Supabase (2026-10-13): "Public / Signed-In
-- Users Can Execute SECURITY DEFINER Function" por es_administrador() (anon y
-- authenticated), mi_plan() y borrar_mi_cuenta() (authenticated).
--
-- Las tres ya solo actúan sobre quien llama (auth.uid()), pero una función con
-- los permisos del dueño en `public` queda expuesta tal cual como RPC. Ahora la
-- lógica con privilegios vive en el esquema `privado`, que la Data API no
-- expone (config.toml: solo public y graphql_public), y en `public` queda una
-- envoltura SECURITY INVOKER con el mismo nombre, así que el navegador
-- (supabase.rpc) y las políticas de RLS no cambian: las políticas guardan el
-- oid de la función, y `create or replace` lo conserva.
--
-- anon deja de poder llamar es_administrador(): nadie sin sesión la necesita.
-- Las políticas de administrador de las muestras pasan a `to authenticated`
-- para que anon nunca las evalúe (sin permiso recibiría un error en vez de
-- cero filas).

create schema if not exists privado;
revoke all on schema privado from public;
grant usage on schema privado to authenticated, service_role;

-- ------------------------------------------------------------ es_administrador
create function privado.es_administrador()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.administradores a
    join auth.users u on lower(u.email) = a.correo
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function privado.es_administrador() from public, anon;
grant execute on function privado.es_administrador() to authenticated, service_role;

create or replace function public.es_administrador()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select privado.es_administrador(); $$;
revoke all on function public.es_administrador() from public, anon;
grant execute on function public.es_administrador() to authenticated, service_role;

alter policy "muestras_select_admin" on muestras_estados_cuenta to authenticated;
alter policy "muestras_update_admin" on muestras_estados_cuenta to authenticated;
alter policy "muestras_delete_admin" on muestras_estados_cuenta to authenticated;

-- --------------------------------------------------------------------- mi_plan
create function privado.mi_plan()
returns table (plan_id text, origen text, vigente_hasta timestamptz, periodo text)
language sql
stable
security definer
set search_path = ''
as $$
  with uid as (select (select auth.uid()) as id),
  pagada as (
    select s.plan_id, 'suscripcion'::text as origen,
           case when s.estado = 'activa' then null else s.periodo_fin end as vigente_hasta,
           s.periodo
    from public.suscripciones s
    join public.planes p on p.id = s.plan_id
    where s.user_id = (select id from uid)
      and (s.estado = 'activa' or (s.estado in ('pausada', 'cancelada') and s.periodo_fin > now()))
    order by p.orden desc, s.creado_en desc
    limit 1
  ),
  prueba as (
    select 'basico'::text, 'prueba'::text, u.created_at + interval '14 days', null::text
    from auth.users u
    where u.id = (select id from uid) and u.created_at + interval '14 days' > now()
  )
  select * from pagada
  union all select * from prueba where not exists (select 1 from pagada)
  union all select 'gratis', 'gratis', null, null
    where (select id from uid) is not null
      and not exists (select 1 from pagada) and not exists (select 1 from prueba);
$$;
revoke all on function privado.mi_plan() from public, anon;
grant execute on function privado.mi_plan() to authenticated, service_role;

create or replace function public.mi_plan()
returns table (plan_id text, origen text, vigente_hasta timestamptz, periodo text)
language sql
stable
security invoker
set search_path = ''
as $$ select * from privado.mi_plan(); $$;
revoke all on function public.mi_plan() from public, anon;
grant execute on function public.mi_plan() to authenticated, service_role;

-- ------------------------------------------------------------ borrar_mi_cuenta
create function privado.borrar_mi_cuenta()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Se necesita una sesión para borrar la cuenta' using errcode = '42501';
  end if;
  if exists (select 1 from public.suscripciones
             where user_id = uid and estado in ('activa', 'pausada')) then
    raise exception 'Cancela tu suscripción antes de borrar la cuenta' using errcode = 'P0001';
  end if;
  delete from auth.users where id = uid;
end
$$;
revoke all on function privado.borrar_mi_cuenta() from public, anon;
grant execute on function privado.borrar_mi_cuenta() to authenticated, service_role;

create or replace function public.borrar_mi_cuenta()
returns void
language sql
security invoker
set search_path = ''
as $$ select privado.borrar_mi_cuenta(); $$;
revoke all on function public.borrar_mi_cuenta() from public, anon;
grant execute on function public.borrar_mi_cuenta() to authenticated, service_role;
