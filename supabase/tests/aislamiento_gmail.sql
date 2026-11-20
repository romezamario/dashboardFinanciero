-- Gmail en la nube (20261120030000_gmail_en_la_nube.sql): el permiso de Gmail
-- nunca se lee desde la API, cada quien solo conecta/ve/borra lo suyo, y la
-- bitácora y los avisos omitidos no se cruzan entre usuarios.

\set ON_ERROR_STOP 1

insert into auth.users (id, email) values ('9a9a9a9a-0000-0000-0000-000000000001', 'gmail-a@prueba.mx'),
                                  ('9b9b9b9b-0000-0000-0000-000000000001', 'gmail-b@prueba.mx');
insert into gmail_revisiones (user_id, origen, resultado) values ('9a9a9a9a-0000-0000-0000-000000000001', 'manual', 'ok'),
                                                            ('9b9b9b9b-0000-0000-0000-000000000001', 'manual', 'ok');
insert into gmail_omitidos (user_id, mensaje_id, tipo) values ('9a9a9a9a-0000-0000-0000-000000000001', 'm1', 'debito');

set role authenticated;
set request.jwt.claim.sub = '9a9a9a9a-0000-0000-0000-000000000001';
select from conectar_gmail('cliente-a', 'secreto-a', 'refresh-a', 'a@gmail.com');
do $$
begin
  if (select count(*) from estado_conexion_gmail()) <> 1 or (select correo from estado_conexion_gmail()) <> 'a@gmail.com' then
    raise exception 'FALLO: A no ve su conexión';
  end if;
  if (select count(*) from gmail_revisiones) <> 1 then raise exception 'FALLO: A ve bitácora ajena'; end if;
  begin
    perform * from gmail_omitidos;
    raise exception 'FALLO: gmail_omitidos se lee desde la API';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from conexiones_gmail();
    raise exception 'FALLO: un usuario lee los permisos de Gmail';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from privado.gmail_conexiones;
    raise exception 'FALLO: un usuario lee privado.gmail_conexiones';
  exception when insufficient_privilege then null;
  end;
  begin
    perform validar_cron_gmail('x');
    raise exception 'FALLO: un usuario prueba secretos del cron';
  exception when insufficient_privilege then null;
  end;
end $$;

set request.jwt.claim.sub = '9b9b9b9b-0000-0000-0000-000000000001';
select from desconectar_gmail();
do $$
begin
  if exists (select 1 from estado_conexion_gmail()) then raise exception 'FALLO: B ve la conexión de A'; end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from privado.gmail_conexiones) <> 1 then raise exception 'FALLO: B borró la conexión de A'; end if;
end $$;

set role anon;
do $$
begin
  begin
    perform conectar_gmail('x', 'y', 'z', null);
    raise exception 'FALLO: anon conecta Gmail';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select from (select set_config('prueba.secreto', secreto, false) from privado.gmail_cron) s;
set role service_role;
do $$
begin
  if (select count(*) from conexiones_gmail()) <> 1 then raise exception 'FALLO: service_role no ve las conexiones'; end if;
  if validar_cron_gmail('incorrecto') or validar_cron_gmail('') then raise exception 'FALLO: secreto falso aceptado'; end if;
  if not validar_cron_gmail(current_setting('prueba.secreto')) then raise exception 'FALLO: el secreto real no pasa'; end if;
end $$;
reset role;

-- Autorización desde el dashboard (20261120050000_gmail_autorizacion_web.sql).
set role service_role;
select from guardar_estado_oauth_gmail(repeat('e', 40), '9a9a9a9a-0000-0000-0000-000000000001', 'https://sitio.test/');
do $$
begin
  if (select count(*) from tomar_estado_oauth_gmail(repeat('e', 40))) <> 1 then raise exception 'FALLO: el state no se lee'; end if;
  if (select count(*) from tomar_estado_oauth_gmail(repeat('e', 40))) <> 0 then raise exception 'FALLO: el state se usa dos veces'; end if;
end $$;
select from guardar_conexion_gmail_web('9a9a9a9a-0000-0000-0000-000000000001', 'web-id', 'web-secreto', 'refresh-web', null);
reset role;

set role authenticated;
set request.jwt.claim.sub = '9a9a9a9a-0000-0000-0000-000000000001';
do $$
begin
  if (select origen from estado_conexion_gmail()) <> 'dashboard' then raise exception 'FALLO: no quedó la conexión del dashboard'; end if;
  if (select correo from estado_conexion_gmail()) <> 'a@gmail.com' then raise exception 'FALLO: se perdió el correo'; end if;
  -- El escritorio no pisa una conexión válida con otro permiso.
  if conectar_gmail('cliente-a', 'secreto-a', 'refresh-viejo', null) then raise exception 'FALLO: el escritorio pisó una conexión válida'; end if;
  if (select origen from estado_conexion_gmail()) <> 'dashboard' then raise exception 'FALLO: cambió la conexión'; end if;
  begin
    perform guardar_conexion_gmail_web('9a9a9a9a-0000-0000-0000-000000000001', 'x', 'y', 'z', null);
    raise exception 'FALLO: un usuario guarda una conexión web';
  exception when insufficient_privilege then null;
  end;
  begin
    perform tomar_estado_oauth_gmail('x');
    raise exception 'FALLO: un usuario lee states';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marcar_gmail_invalido('9a9a9a9a-0000-0000-0000-000000000001', true);
    raise exception 'FALLO: un usuario marca conexiones';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role service_role;
select from marcar_gmail_invalido('9a9a9a9a-0000-0000-0000-000000000001', true);
reset role;
set role authenticated;
do $$
begin
  if not (select invalida from estado_conexion_gmail()) then raise exception 'FALLO: no quedó inválida'; end if;
  -- Inválida: el permiso del escritorio sí la reemplaza.
  if not conectar_gmail('cliente-a', 'secreto-a', 'refresh-nuevo', null) then raise exception 'FALLO: no reemplazó una conexión inválida'; end if;
  if (select origen from estado_conexion_gmail()) <> 'escritorio' or (select invalida from estado_conexion_gmail()) then
    raise exception 'FALLO: la conexión del escritorio no quedó válida';
  end if;
end $$;
reset role;

-- Borrar al usuario borra su conexión.
delete from auth.users where id = '9a9a9a9a-0000-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from privado.gmail_conexiones) then raise exception 'FALLO: la conexión sobrevive al usuario'; end if;
end $$;

\echo 'Gmail en la nube: OK'
