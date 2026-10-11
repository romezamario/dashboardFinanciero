-- Prueba de aislamiento entre usuarios (puerta de la fase 0 del plan de
-- suscripciones): dos usuarios en la misma base, y ninguno puede ver, cambiar,
-- borrar ni referenciar las filas del otro. Corre sobre un Postgres vacío con
-- tests/stub_supabase.sql + todas las migraciones (ver supabase/tests/correr.sh).
-- Cualquier fallo levanta una excepción; con ON_ERROR_STOP psql termina con
-- código distinto de cero.

\set ON_ERROR_STOP 1

-- Ids fijos para poder usarlos desde cualquier rol.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-000000000001', 'a@prueba.mx'),
                                  ('bbbbbbbb-0000-0000-0000-000000000001', 'b@prueba.mx');
insert into bancos (id, nombre) values ('00000000-0000-0000-0000-0000000000b1', 'Banco de prueba');

-- ---------------------------------------------------------------- usuario A
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into cuentas (id, banco_id, alias, ultimos_4_digitos)
  values ('aaaaaaaa-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'Cuenta A', '1111');
insert into categorias (id, nombre) values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Comida');
insert into eventos (id, nombre) values ('aaaaaaaa-0000-0000-0000-0000000000e1', 'Viaje A');
insert into documentos (id, cuenta_id, hash)
  values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'hash-a');
-- Igual que el sincronizador: upsert por (documento_id, pagina, linea_cruda).
insert into transacciones (id, documento_id, categoria_id, evento_id, fecha, descripcion, monto, tipo, pagina, linea_cruda)
  values ('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000d1',
          'aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000e1',
          '2026-10-01', 'TACOS', 120.50, 'cargo', 1, 'linea a')
  on conflict (documento_id, pagina, linea_cruda) do update set monto = excluded.monto;
insert into transacciones (documento_id, fecha, descripcion, monto, tipo, pagina, linea_cruda)
  values ('aaaaaaaa-0000-0000-0000-0000000000d1', '2026-10-01', 'TACOS', 130, 'cargo', 1, 'linea a')
  on conflict (documento_id, pagina, linea_cruda) do update set monto = excluded.monto;
insert into gastos_correo (mensaje_id, fecha, hora, tarjeta, comercio, categoria, monto, evento_id)
  values ('msg-a', '2026-10-01', '12:00', '111', 'Tacos', 'Comida', 120.50, 'aaaaaaaa-0000-0000-0000-0000000000e1');
insert into preferencias (clave, valor) values ('meta_gasto_diario', '1000');
insert into muestras_estados_cuenta (motivo, paginas, texto_anonimizado) values ('banco-desconocido', 1, 'XXXX 00/00/0000');
-- El cliente no puede marcar su muestra como resuelta ni crearla ya revisada.
do $$
declare
  n int;
begin
  update muestras_estados_cuenta set estado = 'resuelta';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: el cliente cambió el estado de su muestra'; end if;
exception when insufficient_privilege then null;
end $$;
do $$
begin
  begin
    insert into muestras_estados_cuenta (motivo, paginas, texto_anonimizado, estado)
      values ('banco-desconocido', 1, 'x', 'resuelta');
    raise exception 'FALLO: el cliente creó una muestra ya resuelta';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Editor masivo del dashboard: cambiar categoría y evento de sus propias filas.
update transacciones set categoria_id = 'aaaaaaaa-0000-0000-0000-0000000000a1', evento_id = null
  where id = 'aaaaaaaa-0000-0000-0000-0000000000f1';

do $$
begin
  if (select count(*) from transacciones) <> 1 or (select monto from transacciones) <> 130 then
    raise exception 'FALLO: A no ve su transacción actualizada por el upsert';
  end if;
end $$;

-- ---------------------------------------------------------------- usuario B
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';

do $$
declare
  n int;
begin
  select (select count(*) from cuentas) + (select count(*) from categorias)
       + (select count(*) from eventos) + (select count(*) from documentos)
       + (select count(*) from transacciones) + (select count(*) from gastos_correo)
       + (select count(*) from preferencias) + (select count(*) from muestras_estados_cuenta)
    into n;
  if n <> 0 then
    raise exception 'FALLO: B ve % filas de A', n;
  end if;
  if (select count(*) from bancos) <> 1 then
    raise exception 'FALLO: B no ve el catálogo compartido de bancos';
  end if;

  update transacciones set monto = 1 where id = 'aaaaaaaa-0000-0000-0000-0000000000f1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: B actualizó una transacción de A'; end if;

  delete from transacciones where id = 'aaaaaaaa-0000-0000-0000-0000000000f1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: B borró una transacción de A'; end if;

  delete from cuentas where id = 'aaaaaaaa-0000-0000-0000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: B borró una cuenta de A'; end if;
end $$;

-- B crea lo suyo (debe poder).
insert into cuentas (id, banco_id, alias, ultimos_4_digitos)
  values ('bbbbbbbb-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'Cuenta B', '2222');
insert into documentos (id, cuenta_id, hash)
  values ('bbbbbbbb-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-0000000000c1', 'hash-b');
insert into transacciones (id, documento_id, fecha, descripcion, monto, tipo, pagina, linea_cruda)
  values ('bbbbbbbb-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-0000000000d1',
          '2026-10-02', 'CAFE', 50, 'cargo', 1, 'linea b');

-- B no puede colgar sus filas de los ids de A.
do $$
begin
  begin
    insert into documentos (cuenta_id, hash) values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'hash-b2');
    raise exception 'FALLO: B creó un documento en la cuenta de A';
  exception when insufficient_privilege then null;
  end;

  begin
    update documentos set cuenta_id = 'aaaaaaaa-0000-0000-0000-0000000000c1'
      where id = 'bbbbbbbb-0000-0000-0000-0000000000d1';
    raise exception 'FALLO: B movió su documento a la cuenta de A';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into transacciones (documento_id, fecha, descripcion, monto, tipo, pagina, linea_cruda)
      values ('aaaaaaaa-0000-0000-0000-0000000000d1', '2026-10-02', 'X', 1, 'cargo', 1, 'intruso');
    raise exception 'FALLO: B insertó una transacción en el documento de A';
  exception when insufficient_privilege then null;
  end;

  begin
    update transacciones set categoria_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
      where id = 'bbbbbbbb-0000-0000-0000-0000000000f1';
    raise exception 'FALLO: B usó una categoría de A';
  exception when insufficient_privilege then null;
  end;

  begin
    update transacciones set evento_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'
      where id = 'bbbbbbbb-0000-0000-0000-0000000000f1';
    raise exception 'FALLO: B usó un evento de A';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into gastos_correo (mensaje_id, fecha, hora, tarjeta, comercio, categoria, monto, evento_id)
      values ('msg-b', '2026-10-02', '12:00', '222', 'Cafe', 'Comida', 50, 'aaaaaaaa-0000-0000-0000-0000000000e1');
    raise exception 'FALLO: B usó un evento de A en gastos_correo';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into transacciones (user_id, documento_id, fecha, descripcion, monto, tipo, pagina, linea_cruda)
      values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d1',
              '2026-10-02', 'X', 1, 'cargo', 1, 'a nombre de A');
    raise exception 'FALLO: B insertó una fila a nombre de A';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------- sin sesión
reset role;
set role anon;
set request.jwt.claim.sub = '';

do $$
begin
  if (select count(*) from transacciones) + (select count(*) from cuentas) <> 0 then
    raise exception 'FALLO: anon ve datos';
  end if;
end $$;

-- ------------------------------------------------- borrar la cuenta de A
reset role;
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';

do $$
begin
  if exists (select 1 from cuentas where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or exists (select 1 from categorias where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or exists (select 1 from eventos where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or exists (select 1 from documentos where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or exists (select 1 from transacciones where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or exists (select 1 from gastos_correo where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or exists (select 1 from preferencias where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or exists (select 1 from muestras_estados_cuenta where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FALLO: quedaron filas de A después de borrar su cuenta';
  end if;
  if (select count(*) from transacciones where user_id = 'bbbbbbbb-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FALLO: borrar la cuenta de A tocó las filas de B';
  end if;
end $$;

-- ------------------------------------------- perfiles y "Borrar mi cuenta"
-- El registro crea el perfil con lo que manda el formulario.
insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000001', 'c@prueba.mx',
   '{"nombre": "  Cecilia ", "terminos_version": "2026-10-11"}');

do $$
begin
  if not exists (select 1 from perfiles
                  where user_id = 'cccccccc-0000-0000-0000-000000000001'
                    and nombre = 'Cecilia' and terminos_version = '2026-10-11'
                    and terminos_aceptados_en is not null) then
    raise exception 'FALLO: el registro no creó el perfil con nombre y términos';
  end if;
  if not exists (select 1 from perfiles
                  where user_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                    and nombre is null and terminos_aceptados_en is null) then
    raise exception 'FALLO: un usuario sin datos de registro no tiene perfil vacío';
  end if;
end $$;

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';

do $$
declare
  n int;
begin
  if (select count(*) from perfiles) <> 1 then
    raise exception 'FALLO: B ve perfiles que no son suyos';
  end if;
  update perfiles set nombre = 'Intruso' where user_id = 'cccccccc-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: B cambió el perfil de C'; end if;
  update perfiles set nombre = 'Beto';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO: B no pudo cambiar su propio nombre'; end if;
end $$;

-- Sin sesión no se puede llamar.
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$
begin
  begin
    perform borrar_mi_cuenta();
    raise exception 'FALLO: anon pudo llamar borrar_mi_cuenta';
  exception when insufficient_privilege then null;
  end;
end $$;

-- C borra su cuenta: se va C con su perfil, B no se toca.
reset role;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
do $$ begin perform borrar_mi_cuenta(); end $$;

reset role;
do $$
begin
  if exists (select 1 from auth.users where id = 'cccccccc-0000-0000-0000-000000000001')
     or exists (select 1 from perfiles where user_id = 'cccccccc-0000-0000-0000-000000000001') then
    raise exception 'FALLO: borrar_mi_cuenta no borró al usuario C';
  end if;
  if not exists (select 1 from auth.users where id = 'bbbbbbbb-0000-0000-0000-000000000001')
     or (select nombre from perfiles where user_id = 'bbbbbbbb-0000-0000-0000-000000000001') <> 'Beto' then
    raise exception 'FALLO: borrar_mi_cuenta de C tocó a B';
  end if;
end $$;

\echo 'Aislamiento entre usuarios: OK'
