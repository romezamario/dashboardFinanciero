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
  if (select count(*) from transacciones) + (select count(*) from cuentas)
     + (select count(*) from muestras_estados_cuenta) <> 0 then
    raise exception 'FALLO: anon ve datos';
  end if;
  -- Sin sesión no se puede ni preguntar (alerta del Security Advisor).
  begin
    perform es_administrador();
    raise exception 'FALLO: anon ejecuta es_administrador()';
  exception when insufficient_privilege then null;
  end;
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

-- ------------------------------------------------- administración de muestras
-- B manda una muestra; el administrador (correo de `administradores`,
-- confirmado) la ve y cambia su estado. El mismo correo sin confirmar no es
-- administrador, y B sigue sin poder cambiar el estado ni ver otras.
reset role;
insert into auth.users (id, email, email_confirmed_at) values
  ('dddddddd-0000-0000-0000-000000000001', 'RomezaMario@gmail.com', now()),
  ('eeeeeeee-0000-0000-0000-000000000001', 'romezamario@gmail.com', null);

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
insert into muestras_estados_cuenta (id, motivo, paginas, texto_anonimizado)
  values ('bbbbbbbb-0000-0000-0000-0000000000a5', 'banco-desconocido', 2, 'XXXX');
do $$
declare
  n int;
begin
  if es_administrador() then raise exception 'FALLO: B es administrador'; end if;
  update muestras_estados_cuenta set estado = 'resuelta';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: B cambió el estado de su muestra'; end if;
end $$;

set request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000001';
do $$
begin
  if es_administrador() or (select count(*) from muestras_estados_cuenta) <> 0 then
    raise exception 'FALLO: un correo de administrador sin confirmar ve muestras';
  end if;
end $$;

set request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000001';
do $$
declare
  n int;
begin
  if not es_administrador() then raise exception 'FALLO: el administrador no es reconocido'; end if;
  if (select count(*) from muestras_estados_cuenta where id = 'bbbbbbbb-0000-0000-0000-0000000000a5') <> 1 then
    raise exception 'FALLO: el administrador no ve la muestra de B';
  end if;
  update muestras_estados_cuenta set estado = 'en-revision' where id = 'bbbbbbbb-0000-0000-0000-0000000000a5';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO: el administrador no pudo cambiar el estado'; end if;
exception when insufficient_privilege then
  raise exception 'FALLO: el administrador no tiene permiso sobre las muestras';
end $$;
do $$
begin
  begin
    perform count(*) from administradores;
    raise exception 'FALLO: la tabla administradores se puede leer por la API';
  exception when insufficient_privilege then null;
  end;
end $$;
delete from muestras_estados_cuenta where id = 'bbbbbbbb-0000-0000-0000-0000000000a5';

reset role;
do $$
begin
  if exists (select 1 from muestras_estados_cuenta where id = 'bbbbbbbb-0000-0000-0000-0000000000a5') then
    raise exception 'FALLO: el administrador no pudo borrar la muestra revisada';
  end if;
end $$;

-- ------------------------------------------- empezar desde cero (administrador)
-- B no es administrador: no puede llamarla. El administrador borra solo lo
-- suyo (movimientos, cuentas, catálogos, avisos) y conserva su perfil; lo de
-- B queda intacto.
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
do $$
begin
  begin
    perform reiniciar_mis_datos();
    raise exception 'FALLO: B (no administrador) pudo borrar sus datos con reiniciar_mis_datos';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$
begin
  begin
    perform reiniciar_mis_datos();
    raise exception 'FALLO: anon pudo llamar reiniciar_mis_datos';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
create temp table antes_de_b as
  select (select count(*) from transacciones where user_id = 'bbbbbbbb-0000-0000-0000-000000000001') as t,
         (select count(*) from cuentas where user_id = 'bbbbbbbb-0000-0000-0000-000000000001') as c,
         (select count(*) from categorias where user_id = 'bbbbbbbb-0000-0000-0000-000000000001') as k;
grant select on antes_de_b to authenticated;

set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000001';
insert into cuentas (id, banco_id, alias, ultimos_4_digitos)
  values ('dddddddd-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'Cuenta D', '4444');
insert into categorias (id, nombre) values ('dddddddd-0000-0000-0000-0000000000a1', 'Comida');
insert into eventos (id, nombre) values ('dddddddd-0000-0000-0000-0000000000e1', 'Viaje D');
insert into documentos (id, cuenta_id, hash)
  values ('dddddddd-0000-0000-0000-0000000000d1', 'dddddddd-0000-0000-0000-0000000000c1', 'hash-d');
insert into transacciones (documento_id, categoria_id, evento_id, fecha, descripcion, monto, tipo, pagina, linea_cruda)
  values ('dddddddd-0000-0000-0000-0000000000d1', 'dddddddd-0000-0000-0000-0000000000a1',
          'dddddddd-0000-0000-0000-0000000000e1', '2026-10-01', 'TACOS', 99, 'cargo', 1, 'linea d1'),
         ('dddddddd-0000-0000-0000-0000000000d1', null, null, '2026-10-02', 'CAFE', 50, 'cargo', 1, 'linea d2');
insert into gastos_correo (mensaje_id, fecha, hora, tarjeta, comercio, categoria, monto, evento_id)
  values ('msg-d', '2026-10-01', '12:00', '444', 'Tacos', 'Comida', 99, 'dddddddd-0000-0000-0000-0000000000e1');
do $$
begin
  if reiniciar_mis_datos() <> 2 then raise exception 'FALLO: reiniciar_mis_datos no reportó 2 movimientos'; end if;
  if exists (select 1 from transacciones) or exists (select 1 from documentos) or exists (select 1 from cuentas)
     or exists (select 1 from categorias) or exists (select 1 from eventos) or exists (select 1 from gastos_correo) then
    raise exception 'FALLO: reiniciar_mis_datos dejó datos del administrador';
  end if;
  if not exists (select 1 from perfiles) then
    raise exception 'FALLO: reiniciar_mis_datos borró el perfil del administrador';
  end if;
end $$;

reset role;
do $$
begin
  if (select count(*) from transacciones where user_id = 'bbbbbbbb-0000-0000-0000-000000000001') <> (select t from antes_de_b)
     or (select count(*) from cuentas where user_id = 'bbbbbbbb-0000-0000-0000-000000000001') <> (select c from antes_de_b)
     or (select count(*) from categorias where user_id = 'bbbbbbbb-0000-0000-0000-000000000001') <> (select k from antes_de_b) then
    raise exception 'FALLO: reiniciar_mis_datos del administrador tocó datos de B';
  end if;
  if (select t from antes_de_b) = 0 then
    raise exception 'FALLO: la prueba no tiene movimientos de B para comprobar';
  end if;
end $$;

-- ------------------------------------------------- planes y suscripciones
-- G se registró hace 30 días (ya sin prueba); H hoy (en su prueba de Básico).
reset role;
insert into auth.users (id, email, created_at) values
  ('12121212-0000-0000-0000-000000000001', 'e@prueba.mx', now() - interval '30 days'),
  ('13131313-0000-0000-0000-000000000001', 'f@prueba.mx', now());

set role authenticated;
set request.jwt.claim.sub = '12121212-0000-0000-0000-000000000001';
do $$
begin
  if (select plan_id from mi_plan()) <> 'gratis' then raise exception 'FALLO: G sin suscripción no está en gratis'; end if;
  if (select count(*) from planes) <> 3 then raise exception 'FALLO: G no ve los planes'; end if;
  -- El cliente no puede darse un plan a sí mismo.
  begin
    insert into suscripciones (user_id, plan_id, periodo, monto, estado, proveedor_id)
      values ('12121212-0000-0000-0000-000000000001', 'pro', 'mensual', 0, 'activa', 'yo-mismo');
    raise exception 'FALLO: G se creó una suscripción';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from avisos_pago;
    raise exception 'FALLO: G lee la bitácora de avisos de pago';
  exception when insufficient_privilege then null;
  end;
end $$;

set request.jwt.claim.sub = '13131313-0000-0000-0000-000000000001';
do $$
begin
  if (select plan_id || '/' || origen from mi_plan()) <> 'basico/prueba' then
    raise exception 'FALLO: H recién registrado no está en la prueba de Básico';
  end if;
end $$;

-- Lo que hace el webhook (service_role): G paga Pro.
set role service_role;
insert into suscripciones (id, user_id, plan_id, periodo, monto, estado, proveedor_id, periodo_fin)
  values ('12121212-0000-0000-0000-0000000000a9', '12121212-0000-0000-0000-000000000001', 'pro', 'mensual', 59,
          'activa', 'mp-e-1', now() + interval '20 days');

set role authenticated;
set request.jwt.claim.sub = '12121212-0000-0000-0000-000000000001';
do $$
declare
  n int;
begin
  if (select plan_id || '/' || origen from mi_plan()) <> 'pro/suscripcion' then
    raise exception 'FALLO: G con suscripción activa no está en Pro';
  end if;
  update suscripciones set plan_id = 'basico', periodo_fin = now() + interval '10 years';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: G cambió su propia suscripción'; end if;
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform borrar_mi_cuenta();
  raise exception 'FALLO: G borró su cuenta con una suscripción activa';
exception when raise_exception then
  if sqlerrm not like 'Cancela tu suscripción%' then raise; end if;
end $$;

-- H no ve la suscripción de G.
set request.jwt.claim.sub = '13131313-0000-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from suscripciones) then raise exception 'FALLO: H ve la suscripción de G'; end if;
end $$;

-- Cancelada: el plan sigue hasta el fin del periodo pagado; después, gratis.
set role service_role;
update suscripciones set estado = 'cancelada' where id = '12121212-0000-0000-0000-0000000000a9';
set role authenticated;
set request.jwt.claim.sub = '12121212-0000-0000-0000-000000000001';
do $$
begin
  if (select plan_id from mi_plan()) <> 'pro' or (select vigente_hasta from mi_plan()) is null then
    raise exception 'FALLO: G cancelada perdió Pro antes del fin de su periodo';
  end if;
end $$;
set role service_role;
update suscripciones set periodo_fin = now() - interval '1 day' where id = '12121212-0000-0000-0000-0000000000a9';
set role authenticated;
do $$
begin
  if (select plan_id from mi_plan()) <> 'gratis' then raise exception 'FALLO: G sigue en Pro después de su periodo'; end if;
end $$;
-- Sin suscripción viva ya puede borrar su cuenta, y la suscripción se va en cascada.
do $$ begin perform borrar_mi_cuenta(); end $$;
reset role;
do $$
begin
  if exists (select 1 from suscripciones where user_id = '12121212-0000-0000-0000-000000000001') then
    raise exception 'FALLO: la suscripción de G sobrevivió al borrado de su cuenta';
  end if;
end $$;

-- Sin sesión: ve los precios, pero ni suscripciones ni su plan.
set role anon;
reset request.jwt.claim.sub;
do $$
begin
  if (select count(*) from planes) <> 3 then raise exception 'FALLO: anon no ve los precios'; end if;
  begin
    perform count(*) from suscripciones;
    raise exception 'FALLO: anon lee suscripciones';
  exception when insufficient_privilege then null;
  end;
  begin
    perform mi_plan();
    raise exception 'FALLO: anon ejecuta mi_plan()';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Aislamiento entre usuarios: OK'

-- ------------------------------- funciones con permisos del dueño fuera de la API
-- Alerta del Security Advisor: ninguna función SECURITY DEFINER en `public`
-- (el esquema que expone la Data API); viven en `privado`.
do $$
declare
  n text;
begin
  select string_agg(p.proname, ', ') into n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'));
  if n is not null then
    raise exception 'FALLO: funciones SECURITY DEFINER ejecutables desde la API: %', n;
  end if;
end $$;
