-- Espacio Salud (2026-11-08, Mario: "este será un subproyecto de ese dashboard
-- personal ... dentro de supabase vivirán varias aplicaciones dependiendo de la
-- categoría"). Primera aplicación: los datos del anillo Oura, leídos en la
-- laptop con `oura.exe sync` (open_health) y subidos desde su `oura.db`.
--
-- Todo vive en el esquema `salud`, separado de Finanzas (`public`). Esta
-- migración NO está en supabase/migrations: la aplica solo el job personal de
-- db-migrate.yml (supabase/espacios/aplicar.sh), así que nunca llega a la
-- instancia de clientes (Ordena tu Lana).
--
-- Solo el dueño de cada fila la ve: las políticas comparan con `auth.uid()` y
-- NO con `usuario_efectivo()` a propósito. El acceso compartido de Finanzas
-- no se extiende a datos de salud.
--
-- Primera versión, flexible: `resumen_diario` (JSON por día y fuente) para
-- los dashboards, y un espejo de los eventos YA DECODIFICADOS de oura.db
-- (`events.decoded_json`, sin el binario crudo). Las tablas con columnas fijas
-- (sueño por noche, HR/HRV por día, etc.) se agregan cuando haya datos reales
-- del anillo para diseñarlas.

create schema salud;
revoke all on schema salud from public;
grant usage on schema salud to authenticated, service_role;

-- ------------------------------------------------------------- oura_anillos
-- Un renglón por anillo (tabla `device` de oura.db). Sin la MAC.
create table salud.oura_anillos (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  serial text not null,
  hardware_id text,
  firmware text,
  api_version text,
  actualizado_en timestamptz not null default now(),
  primary key (user_id, serial)
);

-- ------------------------------------------------------------- oura_eventos
-- Espejo de `events` de oura.db. `ring_timestamp` es el reloj del anillo (no
-- es hora de pared; la conversión la hace open_health y se resolverá al
-- construir las tablas derivadas). `cuerpo_sha256` es la huella del cuerpo
-- binario: con (serial, tag, ring_timestamp) forma la misma llave única que
-- usa oura.db, así resubir nunca duplica. El binario en sí no se sube.
create table salud.oura_eventos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  serial text not null,
  tag smallint not null,
  nombre text not null,
  ring_timestamp bigint not null,
  cuerpo_sha256 text not null check (cuerpo_sha256 ~ '^[0-9a-f]{64}$'),
  datos jsonb,
  capturado_en timestamptz not null,
  unique (user_id, serial, tag, ring_timestamp, cuerpo_sha256)
);
create index oura_eventos_nombre_tiempo on salud.oura_eventos (user_id, nombre, ring_timestamp);

-- ----------------------------------------------------------- resumen_diario
-- Un resumen por día y fuente (p. ej. fuente 'oura'), en JSON flexible
-- mientras se define la forma final de los datos: el colector de la laptop
-- sube lo que calcula oura.exe (sueño, HR, HRV, SpO2, temperatura,
-- actividad). Resubir el mismo día lo reemplaza.
create table salud.resumen_diario (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fecha date not null,
  fuente text not null check (fuente ~ '^[a-z][a-z0-9_]*$'),
  datos jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  primary key (user_id, fecha, fuente)
);

-- ------------------------------------------------------ oura_sincronizaciones
-- Bitácora de cada subida desde la laptop (cuándo, cuántos eventos nuevos).
create table salud.oura_sincronizaciones (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  serial text,
  subida_en timestamptz not null default now(),
  eventos_enviados integer not null default 0 check (eventos_enviados >= 0)
);

-- ------------------------------------------------------------ permisos + RLS
grant select, insert, update, delete on all tables in schema salud to authenticated;
grant all on all tables in schema salud to service_role;
grant usage, select on all sequences in schema salud to authenticated, service_role;

alter table salud.oura_anillos enable row level security;
alter table salud.oura_eventos enable row level security;
alter table salud.oura_sincronizaciones enable row level security;
alter table salud.resumen_diario enable row level security;

create policy "oura_anillos_propios" on salud.oura_anillos
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "oura_eventos_propios" on salud.oura_eventos
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "oura_sincronizaciones_propias" on salud.oura_sincronizaciones
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "resumen_diario_propio" on salud.resumen_diario
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
