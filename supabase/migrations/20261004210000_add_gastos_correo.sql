-- Gastos reportados por los avisos de compra de Banamex (correo), para la
-- pestaña "Gastos recientes". Es una tabla APARTE de `transacciones`: los
-- avisos llegan el mismo día y los estados de cuenta semanas después, así
-- que mezclarlos duplicaría cargos. Aquí no hay documento ni linea_cruda.
--
-- Escritura: la tarea programada (nube) no tiene sesión de usuario ni debe
-- tener la clave service_role (se salta toda la RLS). En su lugar llama a
-- `ingestar_gastos_correo(secreto, gastos)` con la clave anon. La función
-- solo puede insertar/actualizar filas de ESTA tabla, y solo si el secreto
-- coincide con el hash guardado en `ingesta_correo`. El secreto se puede
-- cambiar o revocar cuando se quiera (ver instrucciones al final).

create table gastos_correo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  -- id del mensaje de Gmail: trazabilidad al aviso de origen e idempotencia
  -- (reejecutar un día no duplica).
  mensaje_id text not null,
  fecha date not null,          -- día calendario en hora CDMX
  hora text not null,           -- HH:MM en hora CDMX, tal como viene en el aviso
  tarjeta text not null,        -- terminación: "179", "203", "904"
  comercio text not null,
  categoria text not null,      -- texto libre (reglas_categorizacion.json), sin FK
  establecimiento text,         -- texto crudo del aviso, ej. "MACYS LA PLAZA MALL MCA"
  ciudad_cod text,              -- 3 letras finales del establecimiento
  ciudad text,                  -- solo si el código está confirmado
  monto numeric(12,2) not null check (monto >= 0),
  moneda text not null default 'MXN',
  creado_en timestamptz not null default now(),
  unique (user_id, mensaje_id)
);

create index idx_gastos_correo_fecha on gastos_correo (user_id, fecha);

alter table gastos_correo enable row level security;

-- Solo lectura desde el frontend: la escritura va por la función de abajo.
create policy "gastos_correo_select_own" on gastos_correo
  for select using (user_id = auth.uid());

-- Secreto de ingesta (solo su hash). Sin políticas y sin permisos para
-- anon/authenticated: nadie la lee ni la escribe por la API.
create table ingesta_correo (
  user_id uuid primary key references auth.users(id),
  secreto_hash text not null,
  creado_en timestamptz not null default now()
);

alter table ingesta_correo enable row level security;
revoke all on ingesta_correo from anon, authenticated;

create or replace function ingestar_gastos_correo(p_secreto text, p_gastos jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_n integer;
begin
  if p_secreto is null or length(p_secreto) < 32 then
    raise exception 'no autorizado' using errcode = '28000';
  end if;

  select user_id into v_user
    from ingesta_correo
   where secreto_hash = encode(sha256(convert_to(p_secreto, 'utf8')), 'hex');

  if v_user is null then
    raise exception 'no autorizado' using errcode = '28000';
  end if;

  if jsonb_typeof(p_gastos) <> 'array' or jsonb_array_length(p_gastos) > 500 then
    raise exception 'p_gastos debe ser un arreglo de hasta 500 elementos';
  end if;

  insert into gastos_correo (
    user_id, mensaje_id, fecha, hora, tarjeta, comercio, categoria,
    establecimiento, ciudad_cod, ciudad, monto, moneda
  )
  select
    v_user,
    g->>'mensaje_id',
    (g->>'fecha')::date,
    g->>'hora',
    g->>'tarjeta',
    g->>'comercio',
    g->>'categoria',
    g->>'establecimiento',
    g->>'ciudad_cod',
    nullif(g->>'ciudad', ''),
    (g->>'monto')::numeric(12,2),
    coalesce(g->>'moneda', 'MXN')
  from jsonb_array_elements(p_gastos) as g
  on conflict (user_id, mensaje_id) do update set
    fecha = excluded.fecha,
    hora = excluded.hora,
    tarjeta = excluded.tarjeta,
    comercio = excluded.comercio,
    categoria = excluded.categoria,
    establecimiento = excluded.establecimiento,
    ciudad_cod = excluded.ciudad_cod,
    ciudad = excluded.ciudad,
    monto = excluded.monto,
    moneda = excluded.moneda;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function ingestar_gastos_correo(text, jsonb) from public;
grant execute on function ingestar_gastos_correo(text, jsonb) to anon;

-- ALTA / ROTACIÓN DEL SECRETO (se hace a mano en el SQL Editor de Supabase,
-- NUNCA en una migración, para que el secreto no quede en git):
--   1. Genera un secreto largo y aleatorio (>= 32 caracteres).
--   2. insert into ingesta_correo (user_id, secreto_hash)
--      values ('<tu auth.users.id>',
--              encode(sha256(convert_to('<EL_SECRETO>', 'utf8')), 'hex'))
--      on conflict (user_id) do update set secreto_hash = excluded.secreto_hash;
--   Revocar: delete from ingesta_correo where user_id = '<tu id>';
