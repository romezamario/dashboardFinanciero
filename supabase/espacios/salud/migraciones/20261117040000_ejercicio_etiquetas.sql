-- Salud (2026-11-17, Mario: "permite que agregue alguna descripción como
-- caminata, correr, nadar… la idea es que después las actividades se detecten y
-- clasifiquen automáticamente y yo solo confirme").
--
-- Una fila por sesión de ejercicio (las detecta el colector de la laptop y van
-- dentro de resumen_diario.datos.ejercicio). La sesión se identifica por su
-- inicio unix; también se guarda el fin, porque si el colector cambia sus
-- umbrales la sesión puede moverse unos minutos y el dashboard la vuelve a
-- encontrar por traslape.
--
-- `estado`: 'confirmada' = la eligió o confirmó Mario; 'sugerida' = la propuso
-- un clasificador (hoy el dashboard calcula su sugerencia al vuelo y no la
-- guarda; más adelante el colector podrá escribir aquí con origen 'colector').
-- `tipo` es texto libre acotado (correr, caminata, nadar, bicicleta, gimnasio,
-- otro, no_ejercicio…): un tipo nuevo no necesita migración.
--
-- RLS como el resto del esquema: solo el dueño (`auth.uid()`).

create table salud.ejercicio_etiquetas (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  inicio bigint not null,
  fin bigint not null check (fin > inicio),
  -- Día local al que pertenece la sesión (el de resumen_diario).
  fecha date not null,
  tipo text not null check (tipo ~ '^[a-z_]{2,30}$'),
  estado text not null default 'confirmada' check (estado in ('sugerida', 'confirmada')),
  origen text not null default 'dashboard' check (origen in ('dashboard', 'colector')),
  -- Confianza de una sugerencia automática (0–1); null en las confirmadas a mano.
  confianza real check (confianza between 0 and 1),
  actualizado_en timestamptz not null default now(),
  unique (user_id, inicio)
);
create index ejercicio_etiquetas_fecha on salud.ejercicio_etiquetas (user_id, fecha);

-- Desde 2026-10-30 Supabase ya no da permisos automáticos a tablas nuevas.
grant select, insert, update, delete on salud.ejercicio_etiquetas to authenticated;
grant all on salud.ejercicio_etiquetas to service_role;
grant usage, select on all sequences in schema salud to authenticated, service_role;

alter table salud.ejercicio_etiquetas enable row level security;
create policy "ejercicio_etiquetas_propias" on salud.ejercicio_etiquetas
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
