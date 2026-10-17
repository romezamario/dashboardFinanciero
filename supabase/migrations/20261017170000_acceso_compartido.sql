-- Acceso compartido (2026-10-17, petición de Mario: "un segundo usuario con
-- las mismas funcionalidades"): una persona invitada entra con SU cuenta de
-- Supabase Auth (su correo y contraseña) y trabaja sobre los datos del dueño
-- como si fueran suyos: los mismos movimientos, cuentas, categorías, eventos,
-- avisos de correo y preferencias, con lectura y escritura (editor masivo,
-- eventos, meta diaria).
--
-- Cómo: `usuario_efectivo()` regresa el id del dueño cuando quien llama es un
-- invitado (su correo CONFIRMADO está en `accesos_compartidos`) y `auth.uid()`
-- en cualquier otro caso. Todas las políticas de esas siete tablas comparan
-- contra él en lugar de `auth.uid()`, y los `user_id` toman de él su valor por
-- omisión, así que lo que crea un invitado (una categoría o un evento nuevo)
-- queda a nombre del dueño. Para quien no es invitado no cambia nada.
--
-- La tabla nace VACÍA aquí a propósito: estas migraciones también se aplican a
-- la instancia de clientes, y ahí nadie comparte datos. Las filas las escribe
-- solo el job de la instancia personal de db-migrate.yml, con el secreto
-- CORREOS_INVITADOS (los correos no van al repo, que es público).
--
-- Trading y Wiki no se comparten: eso lo decide el frontend con
-- `soy_invitado()` y, para las Functions de /api, functions/api/_middleware.ts.

create table accesos_compartidos (
  correo_invitado text primary key check (correo_invitado = lower(correo_invitado)),
  correo_dueno text not null check (correo_dueno = lower(correo_dueno)),
  creado_en timestamptz not null default now(),
  check (correo_invitado <> correo_dueno)
);
alter table accesos_compartidos enable row level security;
-- Como `administradores`: sin acceso desde la API; solo service_role y las
-- funciones de `privado`.
revoke all on accesos_compartidos from anon, authenticated;
grant select, insert, update, delete on accesos_compartidos to service_role;
create policy "accesos_compartidos_sin_acceso" on accesos_compartidos
  for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------- usuario_efectivo
create function privado.usuario_efectivo()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select d.id
       from public.accesos_compartidos a
       join auth.users i on lower(i.email) = a.correo_invitado and i.email_confirmed_at is not null
       join auth.users d on lower(d.email) = a.correo_dueno and d.email_confirmed_at is not null
      where i.id = (select auth.uid())
      limit 1),
    (select auth.uid())
  );
$$;
revoke all on function privado.usuario_efectivo() from public, anon;
grant execute on function privado.usuario_efectivo() to authenticated, service_role;

create function public.usuario_efectivo()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$ select privado.usuario_efectivo(); $$;
revoke all on function public.usuario_efectivo() from public, anon;
grant execute on function public.usuario_efectivo() to authenticated, service_role;

-- --------------------------------------------------------------- soy_invitado
-- Para el frontend: oculta Trading y Wiki a un invitado.
create function public.soy_invitado()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select privado.usuario_efectivo() is distinct from (select auth.uid()); $$;
revoke all on function public.soy_invitado() from public, anon;
grant execute on function public.soy_invitado() to authenticated, service_role;

-- ------------------------------------------- políticas y valores por omisión
-- Se reescriben a partir de su definición actual (pg_policies), cambiando solo
-- `auth.uid()` por `public.usuario_efectivo()`: así se conservan intactas las
-- reglas de "referencias propias" de 20261011200000. Pasan a `to
-- authenticated` porque anon no puede ejecutar usuario_efectivo() (sin
-- política que le aplique, anon sigue viendo cero filas, como antes).
do $$
declare
  r record;
  sentencia text;
begin
  for r in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and tablename in ('cuentas', 'categorias', 'documentos', 'transacciones',
                         'eventos', 'gastos_correo', 'preferencias')
  loop
    sentencia := format('alter policy %I on public.%I to authenticated', r.policyname, r.tablename);
    if r.qual is not null then
      sentencia := sentencia || format(' using (%s)', replace(r.qual, 'auth.uid()', 'public.usuario_efectivo()'));
    end if;
    if r.with_check is not null then
      sentencia := sentencia || format(' with check (%s)',
                                       replace(r.with_check, 'auth.uid()', 'public.usuario_efectivo()'));
    end if;
    execute sentencia;
  end loop;
end
$$;

alter table cuentas alter column user_id set default public.usuario_efectivo();
alter table categorias alter column user_id set default public.usuario_efectivo();
alter table documentos alter column user_id set default public.usuario_efectivo();
alter table transacciones alter column user_id set default public.usuario_efectivo();
alter table eventos alter column user_id set default public.usuario_efectivo();
alter table gastos_correo alter column user_id set default public.usuario_efectivo();
alter table preferencias alter column user_id set default public.usuario_efectivo();
