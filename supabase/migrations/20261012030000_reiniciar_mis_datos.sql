-- "Empezar desde cero" para el administrador (2026-10-12, pedido del dueño:
-- "borrar todas las transacciones cargadas, para iniciar desde cero sin tener
-- que darme de baja y luego de alta"). Borra SOLO los datos de quien llama:
-- movimientos, avisos de correo, estados de cuenta, cuentas, categorías y
-- eventos. Se conservan el perfil, las preferencias (la meta diaria) y las
-- muestras. Todo en una transacción: o se borra todo o nada.
-- security invoker: las políticas de RLS siguen aplicando, así que aunque el
-- filtro por user_id fallara no podría tocar filas de otro usuario.
create function public.reiniciar_mis_datos()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  borradas integer;
begin
  if uid is null or not public.es_administrador() then
    raise exception 'Solo un administrador puede borrar sus datos así' using errcode = '42501';
  end if;
  delete from public.transacciones where user_id = uid;
  get diagnostics borradas = row_count;
  delete from public.gastos_correo where user_id = uid;
  delete from public.documentos where user_id = uid;
  delete from public.cuentas where user_id = uid;
  delete from public.categorias where user_id = uid;
  delete from public.eventos where user_id = uid;
  return borradas;
end
$$;

revoke all on function public.reiniciar_mis_datos() from public, anon;
grant execute on function public.reiniciar_mis_datos() to authenticated;
