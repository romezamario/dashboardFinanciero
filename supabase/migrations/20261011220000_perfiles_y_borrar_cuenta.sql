-- Fase 1 de FinanzasPersonales (cuentas): perfil de cada usuario y "Borrar mi
-- cuenta". Se aplica también a la instancia personal; ahí solo crea la tabla
-- y la fila del usuario que ya existe, sin cambiar nada de lo que se ve.

-- Perfil: nombre y qué versión de los términos y del aviso de privacidad
-- aceptó y cuándo (lo pide la LFPDPPP para poder demostrarlo).
create table perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  nombre text,
  terminos_version text,
  terminos_aceptados_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table perfiles enable row level security;

create policy "perfiles_select_own" on perfiles
  for select using (user_id = (select auth.uid()));
create policy "perfiles_insert_own" on perfiles
  for insert with check (user_id = (select auth.uid()));
create policy "perfiles_update_own" on perfiles
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "perfiles_delete_own" on perfiles
  for delete using (user_id = (select auth.uid()));

-- Regla del 30 de oct.: las tablas nuevas necesitan grant explícito. `anon`
-- no tiene nada que hacer aquí.
grant select, insert, update, delete on perfiles to authenticated;
grant all on perfiles to service_role;

-- El perfil se crea al registrarse, desde los datos que manda el formulario
-- (`options.data` de signUp). Tiene que ser un trigger: con la verificación de
-- correo obligatoria, al registrarse todavía no hay sesión para insertar desde
-- el navegador.
create function public.crear_perfil_de_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  version text := nullif(trim(new.raw_user_meta_data ->> 'terminos_version'), '');
begin
  insert into public.perfiles (user_id, nombre, terminos_version, terminos_aceptados_en)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''),
    version,
    case when version is not null then now() end
  )
  on conflict (user_id) do nothing;
  return new;
end
$$;

revoke all on function public.crear_perfil_de_usuario() from public, anon, authenticated;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_de_usuario();

-- Usuarios que ya existían (el dueño en la instancia personal).
insert into perfiles (user_id)
  select id from auth.users
  on conflict (user_id) do nothing;

-- "Borrar mi cuenta": el navegador no puede borrar de auth.users, así que una
-- función con los permisos del dueño borra SOLO al usuario de la sesión. Todas
-- sus filas se van en cascada (migración 20261011200000).
create function public.borrar_mi_cuenta()
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
  delete from auth.users where id = uid;
end
$$;

revoke all on function public.borrar_mi_cuenta() from public, anon;
grant execute on function public.borrar_mi_cuenta() to authenticated;
