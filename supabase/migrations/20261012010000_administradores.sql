-- Pantalla de administración de Ordena tu Lana (2026-10-12, pedido del dueño:
-- "las muestras de clientes dámelas en una pantalla de administración para mí
-- como administrador dentro de la plataforma"). Quién es administrador se
-- decide por correo CONFIRMADO, así que sirve aunque la cuenta se cree después
-- de aplicar esta migración. La tabla no es visible desde la API: solo la
-- consulta es_administrador(), que únicamente dice sí o no de quien llama.
create table administradores (
  correo text primary key check (correo = lower(correo)),
  creado_en timestamptz not null default now()
);

alter table administradores enable row level security;
-- Sin políticas ni permisos para anon/authenticated: nadie la lee ni la
-- modifica por la API. Se agrega un administrador con una migración.
revoke all on administradores from anon, authenticated;
grant all on administradores to service_role;

insert into administradores (correo) values ('romezamario@gmail.com');

create function es_administrador()
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

-- anon también puede llamarla (responde falso): las políticas de abajo la
-- evalúan para cualquier rol, y sin permiso un anon recibiría un error en vez
-- de cero filas.
revoke execute on function es_administrador() from public;
grant execute on function es_administrador() to anon, authenticated, service_role;

-- El administrador ve todas las muestras, cambia su estado y puede borrarlas
-- (ya revisadas, no hace falta guardar ni su estructura). El cliente sigue sin
-- poder cambiar el estado de la suya.
create policy "muestras_select_admin" on muestras_estados_cuenta
  for select using ((select es_administrador()));
create policy "muestras_update_admin" on muestras_estados_cuenta
  for update using ((select es_administrador())) with check ((select es_administrador()));
create policy "muestras_delete_admin" on muestras_estados_cuenta
  for delete using ((select es_administrador()));

grant update (estado) on muestras_estados_cuenta to authenticated;
