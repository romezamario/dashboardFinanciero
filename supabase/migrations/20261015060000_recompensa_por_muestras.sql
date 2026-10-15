-- Recompensa por muestras anonimizadas (2026-10-15, pedido del dueño): a quien
-- mande una muestra que termine en un lector nuevo o en un arreglo de uno, y
-- confirme que ya ve todos sus movimientos, se le regala tiempo de plan:
--   Pro de pago → 1 mes de Pro; Básico de pago → 2 meses de Básico;
--   sin plan de pago (prueba o gratis) → 1 mes de Pro.
-- Diseño: /mnt/project-files/notas/recompensa-por-muestras.md (fuera del repo).
--
-- Contra el abuso:
--   * la recompensa sale de un CAMBIO en el código, no de mandar muestras: el
--     administrador marca la muestra con `clave_cambio` y cada clave paga una
--     sola vez (bonificaciones.clave_cambio es única);
--   * solo la base otorga la bonificación (privado.confirmar_muestra), nunca
--     el navegador, y exige un estado de cuenta guardado del banco del lector;
--   * límites al enviar: 3 muestras al día, no repetir una muestra idéntica
--     que sigue pendiente, y quien acumula 3 "ya se leía completo" en 30 días
--     no puede mandar más de "faltan movimientos" por un tiempo.
--
-- El tiempo regalado vive aquí (bonificaciones), no en Mercado Pago. A quien
-- tiene una suscripción que sigue cobrando se le guarda como saldo a favor
-- (desde/hasta en null) y se activa cuando esa suscripción se cancela.

-- --------------------------------------------------------------- muestras
alter table muestras_estados_cuenta drop constraint muestras_estados_cuenta_estado_check;
alter table muestras_estados_cuenta add constraint muestras_estados_cuenta_estado_check
  check (estado in ('nueva', 'en-revision', 'lista-para-probar', 'con-retro', 'confirmada', 'resuelta', 'descartada'));

alter table muestras_estados_cuenta
  -- Lo decide el administrador al revisarla.
  add column resultado text check (resultado in ('lector-nuevo', 'arreglo', 'repetida', 'ya-se-leia', 'no-sirve')),
  -- Qué cambio del código originó (p. ej. "bbva-debito"); paga una sola vez.
  add column clave_cambio text check (clave_cambio ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  -- Nombre del banco tal como lo guarda el lector (bancos.nombre): para
  -- confirmar, el cliente debe tener un estado de cuenta guardado de ese banco.
  add column banco_lector text check (char_length(banco_lector) <= 100),
  add column recompensa boolean not null default false,
  add column mensaje_cliente text check (char_length(mensaje_cliente) <= 500),
  add column revisada_en timestamptz,
  add column confirmada_en timestamptz,
  -- Retroalimentación: la muestra anterior del mismo ciclo.
  add column muestra_origen_id uuid references muestras_estados_cuenta(id) on delete set null,
  -- Cuántos movimientos sí leyó la app (solo "faltan movimientos").
  add column movimientos_leidos integer check (movimientos_leidos between 0 and 100000),
  add constraint muestras_recompensa_con_clave
    check (not recompensa or (resultado in ('lector-nuevo', 'arreglo') and clave_cambio is not null));

create index idx_muestras_usuario on muestras_estados_cuenta (user_id, creado_en);

-- El cliente solo escribe las columnas de su envío; lo demás es del
-- administrador (antes podía mandar cualquier columna en el insert).
revoke insert on muestras_estados_cuenta from authenticated;
grant insert (id, motivo, banco_detectado, comentario, paginas, texto_anonimizado, movimientos_leidos, muestra_origen_id)
  on muestras_estados_cuenta to authenticated;
grant update (estado, resultado, clave_cambio, banco_lector, recompensa, mensaje_cliente, revisada_en)
  on muestras_estados_cuenta to authenticated;

-- Límites al enviar y enlace de la retroalimentación. SECURITY DEFINER porque
-- marca la muestra anterior como "con-retro" (el cliente no tiene update).
create function privado.antes_de_enviar_muestra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  origen public.muestras_estados_cuenta;
begin
  if (select count(*) from public.muestras_estados_cuenta
      where user_id = new.user_id and creado_en > now() - interval '1 day') >= 3 then
    raise exception 'Ya enviaste 3 muestras hoy. Inténtalo de nuevo mañana.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.muestras_estados_cuenta
             where user_id = new.user_id and estado in ('nueva', 'en-revision')
               and md5(texto_anonimizado) = md5(new.texto_anonimizado)) then
    raise exception 'Ya recibimos esta misma muestra y la estamos revisando.' using errcode = 'P0001';
  end if;
  if new.motivo = 'faltan-movimientos' and (
       select count(*) from public.muestras_estados_cuenta
       where user_id = new.user_id and resultado = 'ya-se-leia' and revisada_en > now() - interval '30 days') >= 3 then
    raise exception 'Revisamos tus últimas muestras y tus estados de cuenta se leían completos. Podrás enviar otra más adelante.'
      using errcode = 'P0001';
  end if;
  if new.muestra_origen_id is not null then
    select * into origen from public.muestras_estados_cuenta where id = new.muestra_origen_id for update;
    if origen.id is null or origen.user_id <> new.user_id or origen.estado <> 'lista-para-probar' then
      raise exception 'Esa muestra no está esperando tu confirmación.' using errcode = 'P0001';
    end if;
    update public.muestras_estados_cuenta set estado = 'con-retro' where id = origen.id;
  end if;
  return new;
end
$$;
revoke all on function privado.antes_de_enviar_muestra() from public, anon, authenticated;

create trigger antes_de_enviar_muestra
  before insert on muestras_estados_cuenta
  for each row execute function privado.antes_de_enviar_muestra();

-- ----------------------------------------------------------- bonificaciones
create table bonificaciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references planes(id) check (plan_id <> 'gratis'),
  meses integer not null check (meses between 1 and 12),
  -- null/null = saldo a favor: se activa cuando termina su suscripción.
  desde timestamptz,
  hasta timestamptz,
  motivo text not null default 'muestra' check (motivo in ('muestra')),
  muestra_id uuid references muestras_estados_cuenta(id) on delete set null,
  -- Un cambio del código paga una sola vez, aunque lo pidan varios clientes.
  clave_cambio text unique,
  creado_en timestamptz not null default now(),
  check ((desde is null) = (hasta is null)),
  check (hasta is null or hasta > desde)
);

create index bonificaciones_user_id_idx on bonificaciones (user_id);

alter table bonificaciones enable row level security;
create policy "bonificaciones_select_own" on bonificaciones
  for select to authenticated using (user_id = (select auth.uid()));
create policy "bonificaciones_select_admin" on bonificaciones
  for select to authenticated using ((select es_administrador()));
-- Sin insert/update/delete por la API: solo las funciones de `privado`.
revoke all on bonificaciones from anon, authenticated;
grant select on bonificaciones to authenticated;
grant all on bonificaciones to service_role;

-- Otorga la bonificación de una muestra confirmada. Devuelve la fila creada,
-- o nada si esa clave ya pagó.
create function privado.otorgar_bonificacion(uid uuid, muestra uuid, clave text)
returns public.bonificaciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  viva public.suscripciones;
  vigente public.suscripciones;
  plan text := 'pro';
  meses integer := 1;
  inicio timestamptz;
  fila public.bonificaciones;
begin
  if exists (select 1 from public.bonificaciones where clave_cambio = clave) then
    return null;
  end if;

  select s.* into viva from public.suscripciones s join public.planes p on p.id = s.plan_id
  where s.user_id = uid and s.estado in ('activa', 'pausada')
  order by p.orden desc, s.creado_en desc limit 1;

  select s.* into vigente from public.suscripciones s join public.planes p on p.id = s.plan_id
  where s.user_id = uid and s.estado = 'cancelada' and s.periodo_fin > now()
  order by p.orden desc, s.periodo_fin desc limit 1;

  if viva.id is not null then
    plan := viva.plan_id;
  elsif vigente.id is not null then
    plan := vigente.plan_id;
  end if;
  if plan = 'basico' then meses := 2; end if;

  if viva.id is null then
    -- Empieza hoy, o cuando termine lo ya pagado o la bonificación anterior.
    inicio := greatest(
      now(),
      coalesce(vigente.periodo_fin, now()),
      coalesce((select max(b.hasta) from public.bonificaciones b where b.user_id = uid), now())
    );
  end if;

  insert into public.bonificaciones (user_id, plan_id, meses, desde, hasta, muestra_id, clave_cambio)
  values (uid, plan, meses, inicio, inicio + make_interval(months => meses), muestra, clave)
  on conflict (clave_cambio) do nothing
  returning * into fila;
  return fila;
end
$$;
revoke all on function privado.otorgar_bonificacion(uuid, uuid, text) from public, anon, authenticated;

-- El cliente confirma que ya ve todos sus movimientos. Si la muestra lo
-- merece, se otorga la bonificación. Devuelve la bonificación (o vacío).
create function privado.confirmar_muestra(p_muestra uuid)
returns setof public.bonificaciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  m public.muestras_estados_cuenta;
  fila public.bonificaciones;
begin
  if uid is null then
    raise exception 'Se necesita una sesión' using errcode = '42501';
  end if;
  select * into m from public.muestras_estados_cuenta where id = p_muestra and user_id = uid for update;
  if m.id is null or m.estado <> 'lista-para-probar' then
    raise exception 'Esta muestra no está esperando tu confirmación.' using errcode = 'P0001';
  end if;
  if m.banco_lector is not null and not exists (
    select 1 from public.documentos d
    join public.cuentas c on c.id = d.cuenta_id
    join public.bancos b on b.id = c.banco_id
    where d.user_id = uid and b.nombre = m.banco_lector
  ) then
    raise exception 'Primero sube y guarda tu estado de cuenta de %; después confirma.', m.banco_lector
      using errcode = 'P0001';
  end if;

  update public.muestras_estados_cuenta set estado = 'confirmada', confirmada_en = now() where id = m.id;

  if m.recompensa and m.clave_cambio is not null then
    fila := privado.otorgar_bonificacion(uid, m.id, m.clave_cambio);
    if fila.id is not null then
      return next fila;
    end if;
  end if;
end
$$;
revoke all on function privado.confirmar_muestra(uuid) from public, anon;
grant execute on function privado.confirmar_muestra(uuid) to authenticated, service_role;

create function public.confirmar_muestra(p_muestra uuid)
returns setof public.bonificaciones
language sql
security invoker
set search_path = ''
as $$ select * from privado.confirmar_muestra(p_muestra); $$;
revoke all on function public.confirmar_muestra(uuid) from public, anon;
grant execute on function public.confirmar_muestra(uuid) to authenticated, service_role;

-- Saldo a favor: cuando la suscripción que cobraba se cancela y ya no queda
-- otra viva, las bonificaciones pendientes empiezan al terminar lo pagado.
create function privado.activar_saldo_a_favor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bonificaciones;
  inicio timestamptz;
begin
  if new.estado <> 'cancelada' or old.estado not in ('activa', 'pausada') then
    return new;
  end if;
  if exists (select 1 from public.suscripciones
             where user_id = new.user_id and id <> new.id and estado in ('activa', 'pausada')) then
    return new;
  end if;
  for b in select * from public.bonificaciones
           where user_id = new.user_id and desde is null order by creado_en loop
    inicio := greatest(
      now(),
      coalesce(new.periodo_fin, now()),
      coalesce((select max(x.hasta) from public.bonificaciones x where x.user_id = new.user_id), now())
    );
    update public.bonificaciones
      set desde = inicio, hasta = inicio + make_interval(months => b.meses)
      where id = b.id;
  end loop;
  return new;
end
$$;
revoke all on function privado.activar_saldo_a_favor() from public, anon, authenticated;

create trigger activar_saldo_a_favor
  after update of estado on suscripciones
  for each row execute function privado.activar_saldo_a_favor();

-- ---------------------------------------------------------------- mi_plan
-- Igual que antes, más las bonificaciones en curso: gana el plan más alto;
-- a plan igual, la suscripción. `vigente_hasta` de una bonificación es el fin
-- de las bonificaciones encadenadas de ese plan.
create or replace function privado.mi_plan()
returns table (plan_id text, origen text, vigente_hasta timestamptz, periodo text)
language sql
stable
security definer
set search_path = ''
as $$
  with uid as (select (select auth.uid()) as id),
  candidatos as (
    select s.plan_id, 'suscripcion'::text as origen,
           case when s.estado = 'activa' then null else s.periodo_fin end as vigente_hasta,
           s.periodo, p.orden, 1 as preferencia, s.creado_en
    from public.suscripciones s
    join public.planes p on p.id = s.plan_id
    where s.user_id = (select id from uid)
      and (s.estado = 'activa' or (s.estado in ('pausada', 'cancelada') and s.periodo_fin > now()))
    union all
    select b.plan_id, 'bonificacion'::text,
           (select max(x.hasta) from public.bonificaciones x
            where x.user_id = b.user_id and x.plan_id = b.plan_id and x.hasta is not null),
           null::text, p.orden, 0, b.creado_en
    from public.bonificaciones b
    join public.planes p on p.id = b.plan_id
    where b.user_id = (select id from uid) and b.desde <= now() and b.hasta > now()
  ),
  elegida as (
    select c.plan_id, c.origen, c.vigente_hasta, c.periodo from candidatos c
    order by c.orden desc, c.preferencia desc, c.creado_en desc
    limit 1
  ),
  prueba as (
    select 'basico'::text, 'prueba'::text, u.created_at + interval '14 days', null::text
    from auth.users u
    where u.id = (select id from uid) and u.created_at + interval '14 days' > now()
  )
  select * from elegida
  union all select * from prueba where not exists (select 1 from elegida)
  union all select 'gratis', 'gratis', null, null
    where (select id from uid) is not null
      and not exists (select 1 from elegida) and not exists (select 1 from prueba);
$$;
