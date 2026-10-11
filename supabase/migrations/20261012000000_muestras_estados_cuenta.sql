-- Fase 2 de Ordena tu Lana: cuando el navegador no sabe leer el PDF de un
-- banco, el cliente puede mandar una MUESTRA ANONIMIZADA (cada dígito → 0,
-- cada letra → X; ver frontend/src/lib/importar/anonimizar.ts) para que se
-- escriba el lector de ese banco. El PDF y su texto real nunca salen de su
-- computadora; esto solo trae la estructura. Decisión del dueño (2026-10-11):
-- la muestra queda a revisión (Claude propone el lector, el dueño lo aprueba),
-- sin llamar a ninguna API de pago.
create table muestras_estados_cuenta (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  creado_en timestamptz not null default now(),
  -- Por qué no se pudo leer: sin-texto | banco-desconocido | sin-movimientos | faltan-movimientos
  motivo text not null check (motivo in ('sin-texto', 'banco-desconocido', 'sin-movimientos', 'faltan-movimientos')),
  -- Lector que lo reconoció, si alguno (p. ej. lo reconoció pero no sacó movimientos).
  banco_detectado text check (char_length(banco_detectado) <= 100),
  -- Lo que el cliente dice del banco/producto ("BBVA débito"), opcional.
  comentario text check (char_length(comentario) <= 500),
  paginas integer not null check (paginas between 0 and 500),
  texto_anonimizado text not null check (char_length(texto_anonimizado) <= 200000),
  -- nueva → en-revision → resuelta | descartada. Solo lo cambia quien revisa
  -- (service_role); el cliente no tiene permiso de update.
  estado text not null default 'nueva' check (estado in ('nueva', 'en-revision', 'resuelta', 'descartada'))
);

create index idx_muestras_estado on muestras_estados_cuenta (estado, creado_en);

alter table muestras_estados_cuenta enable row level security;

create policy "muestras_select_own" on muestras_estados_cuenta
  for select using (user_id = (select auth.uid()));
-- Solo puede crear muestras "nuevas" a su nombre.
create policy "muestras_insert_own" on muestras_estados_cuenta
  for insert with check (user_id = (select auth.uid()) and estado = 'nueva');
create policy "muestras_delete_own" on muestras_estados_cuenta
  for delete using (user_id = (select auth.uid()));

grant select, insert, delete on muestras_estados_cuenta to authenticated;
grant all on muestras_estados_cuenta to service_role;
