-- Esquema canónico del dashboard financiero.
-- Fuente de verdad remota: Supabase (Postgres).

create table bancos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

create table cuentas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  banco_id uuid not null references bancos(id),
  alias text not null,
  ultimos_4_digitos text,
  creado_en timestamptz not null default now(),
  unique (user_id, banco_id, ultimos_4_digitos)
);

create table categorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  nombre text not null,
  unique (user_id, nombre)
);

create table documentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  cuenta_id uuid not null references cuentas(id),
  hash text not null,
  periodo_inicio date,
  periodo_fin date,
  ruta_local text,
  procesado_en timestamptz not null default now(),
  unique (user_id, hash)
);

create table transacciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  documento_id uuid not null references documentos(id),
  categoria_id uuid references categorias(id),
  fecha date not null,
  descripcion text not null,
  monto numeric(12,2) not null check (monto >= 0),
  tipo text not null check (tipo in ('cargo','abono')),
  moneda text not null default 'MXN',
  saldo numeric(12,2),
  pagina integer not null,
  linea_cruda text not null,
  creado_en timestamptz not null default now(),
  unique (documento_id, pagina, linea_cruda)
);

create index idx_transacciones_fecha on transacciones (user_id, fecha);
create index idx_transacciones_categoria on transacciones (user_id, categoria_id);

alter table cuentas enable row level security;
alter table categorias enable row level security;
alter table documentos enable row level security;
alter table transacciones enable row level security;
