-- Fase 3 de Ordena tu Lana: planes y suscripciones con Mercado Pago (primero
-- con usuarios de prueba, sin cobros reales). Se aplica también a la
-- instancia personal, donde no cambia nada de lo que se ve: ahí nadie se
-- suscribe y ningún límite depende todavía del plan.
--
-- Quién escribe qué:
--   planes         → solo migraciones (precios y límites).
--   suscripciones  → solo las Edge Functions con la llave service_role
--                    (crear-suscripcion, cancelar-suscripcion y el webhook).
--                    El cliente solo LEE su fila: el navegador nunca decide
--                    su plan.
--   avisos_pago    → solo el webhook; sin acceso desde la API.

create table planes (
  id text primary key,
  nombre text not null,
  precio_mensual numeric(10, 2) not null,
  precio_anual numeric(10, 2) not null,
  -- null = sin límite. Todavía no se aplican (ver CLAUDE.md, fase 3).
  max_cuentas integer,
  meses_historial integer,
  max_reglas integer,
  orden integer not null
);

-- Mismos precios que frontend/src/lib/planes.ts (lo que ve la página de
-- precios); la Edge Function cobra lo que dice ESTA tabla.
insert into planes (id, nombre, precio_mensual, precio_anual, max_cuentas, meses_historial, max_reglas, orden) values
  ('gratis', 'Gratis', 0, 0, 1, 3, 20, 0),
  ('basico', 'Básico', 29, 290, 5, null, null, 1),
  ('pro', 'Pro', 59, 590, null, null, null, 2);

alter table planes enable row level security;
create policy "planes_select_todos" on planes for select using (true);
revoke all on planes from anon, authenticated;
grant select on planes to anon, authenticated;
grant all on planes to service_role;

create table suscripciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references planes(id) check (plan_id <> 'gratis'),
  periodo text not null check (periodo in ('mensual', 'anual')),
  monto numeric(10, 2) not null,
  moneda text not null default 'MXN',
  -- pendiente: se creó y el cliente todavía no paga en Mercado Pago.
  estado text not null default 'pendiente' check (estado in ('pendiente', 'activa', 'pausada', 'cancelada')),
  -- Neutral al proveedor: cambiar a Stripe después no obliga a rehacer tablas.
  proveedor text not null default 'mercadopago',
  proveedor_id text not null,
  -- Próximo cobro mientras está activa; al cancelar se conserva: el plan
  -- sigue vigente hasta esa fecha (lo que ya pagó).
  periodo_fin timestamptz,
  ultimo_cobro_en timestamptz,
  ultimo_cobro_estado text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (proveedor, proveedor_id)
);

create index suscripciones_user_id_idx on suscripciones (user_id);

alter table suscripciones enable row level security;
create policy "suscripciones_select_own" on suscripciones
  for select using (user_id = (select auth.uid()));
-- Sin políticas de insert/update/delete: solo service_role (que salta RLS).
revoke all on suscripciones from anon, authenticated;
grant select on suscripciones to authenticated;
grant all on suscripciones to service_role;

-- Bitácora de avisos del webhook (auditoría y para depurar en modo de prueba).
create table avisos_pago (
  id bigint generated always as identity primary key,
  proveedor text not null default 'mercadopago',
  tipo text,
  recurso_id text,
  request_id text,
  firma_valida boolean not null,
  resultado text,
  recibido_en timestamptz not null default now()
);

alter table avisos_pago enable row level security;
revoke all on avisos_pago from anon, authenticated;
grant all on avisos_pago to service_role;

-- El plan efectivo de quien llama. Nunca lo decide el navegador:
--   1. una suscripción activa, o pausada/cancelada con su periodo pagado sin
--      terminar → ese plan (si hubiera varias, la del plan más alto);
--   2. si no, los primeros 14 días desde el registro → prueba de Básico, sin
--      tarjeta (DIAS_PRUEBA en planes.ts);
--   3. si no, gratis.
create function public.mi_plan()
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

revoke all on function public.mi_plan() from public, anon;
grant execute on function public.mi_plan() to authenticated;

-- "Borrar mi cuenta" no puede dejar un cobro recurrente vivo en Mercado Pago
-- (el borrado en cascada solo quita la fila de aquí). El navegador cancela la
-- suscripción antes de borrar; si no lo logró, la base se niega a borrar.
create or replace function public.borrar_mi_cuenta()
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
