-- Aislamiento del espacio Salud (auditoría 2026-11-14, M4): sus tablas viven en
-- el esquema `salud` (supabase/espacios/salud) y solo el dueño de cada fila la
-- ve; ni otro usuario ni anon. Corre después de tests/aislamiento.sql con sus propios
-- usuarios A y B y las migraciones de los espacios ya aplicadas.

\set ON_ERROR_STOP 1

insert into auth.users (id, email) values ('5a5a5a5a-0000-0000-0000-000000000001', 'salud-a@prueba.mx'),
                                  ('5b5b5b5b-0000-0000-0000-000000000001', 'salud-b@prueba.mx');

set role authenticated;
set request.jwt.claim.sub = '5a5a5a5a-0000-0000-0000-000000000001';
insert into salud.resumen_diario (fecha, fuente, datos)
  values ('2026-11-10', 'oura', '{"noche": {"hrv_ms": 50, "stages": [1, 2, 3], "series_t": {"hr": [[1, 60]]}}}');
insert into salud.oura_anillos (serial) values ('anillo-a');
insert into salud.oura_sincronizaciones (serial, bateria_pct) values ('anillo-a', 80);
insert into salud.viajes (lugar, desde) values ('Las Vegas', '2026-11-09');

do $$
begin
  if (select count(*) from salud.resumen_ligero) <> 1 then
    raise exception 'FALLO: A no ve su día en resumen_ligero';
  end if;
  if (select datos -> 'noche' ? 'stages' or datos -> 'noche' ? 'series_t' from salud.resumen_ligero) then
    raise exception 'FALLO: resumen_ligero trae las series de la noche';
  end if;
  if (select (datos -> 'noche' ->> 'hrv_ms')::int from salud.resumen_ligero) <> 50 then
    raise exception 'FALLO: resumen_ligero perdió los signos vitales';
  end if;
end $$;

-- B no ve, cambia ni borra nada de A, ni siquiera a través de la vista.
set request.jwt.claim.sub = '5b5b5b5b-0000-0000-0000-000000000001';
do $$
declare
  n int;
begin
  select (select count(*) from salud.resumen_diario) + (select count(*) from salud.resumen_ligero)
       + (select count(*) from salud.oura_anillos) + (select count(*) from salud.oura_sincronizaciones)
       + (select count(*) from salud.viajes)
    into n;
  if n <> 0 then raise exception 'FALLO: B ve % filas de salud de A', n; end if;
  update salud.resumen_diario set datos = '{}';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: B cambió el resumen de A'; end if;
  delete from salud.viajes;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: B borró los viajes de A'; end if;
end $$;
do $$
begin
  begin
    insert into salud.resumen_diario (user_id, fecha, fuente) values ('5a5a5a5a-0000-0000-0000-000000000001', '2026-11-11', 'oura');
    raise exception 'FALLO: B escribió un día a nombre de A';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- anon no tiene ni el esquema.
set role anon;
do $$
begin
  begin
    perform 1 from salud.resumen_diario;
    raise exception 'FALLO: anon lee salud.resumen_diario';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Aislamiento de Salud: OK'
