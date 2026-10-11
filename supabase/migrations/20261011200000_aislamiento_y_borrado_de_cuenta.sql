-- Fase 0 de FinanzasPersonales (plan de suscripciones, 2026-10-11): la misma
-- base de datos va a tener clientes, no solo al dueño. Dos cambios, que no
-- alteran nada de lo que ya funciona para un usuario que solo toca sus filas:
--
-- 1. Llaves foráneas del mismo usuario. Las políticas de insert/update solo
--    revisaban `user_id = auth.uid()` en la fila misma, no que el documento,
--    la cuenta, la categoría o el evento a los que apunta fueran también del
--    usuario. Con un solo usuario era una brecha aceptada; con clientes, uno
--    podría colgar sus filas de los ids de otro (o descubrir si un id existe).
--    Ahora el `with check` exige que cada referencia sea propia.
--
-- 2. Borrado de cuenta. Borrar un usuario de `auth.users` fallaba por las
--    llaves foráneas sin acción; ahora borra en cascada todas sus filas
--    (`preferencias` ya lo hacía). Es lo que va a usar "Borrar mi cuenta".

-- 1. user_id -> auth.users con on delete cascade. Se buscan por definición y
-- no por nombre, por si algún nombre generado difiere del esperado.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tabla, c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
       and array_length(c.conkey, 1) = 1
       and a.attname = 'user_id'
       and c.confdeltype <> 'c'
       and c.conrelid in ('public.cuentas'::regclass, 'public.categorias'::regclass,
                          'public.documentos'::regclass, 'public.transacciones'::regclass,
                          'public.eventos'::regclass, 'public.gastos_correo'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (user_id) references auth.users(id) on delete cascade',
      r.tabla, r.conname);
  end loop;
end
$$;

-- 2. Referencias propias en insert/update. `(select auth.uid())` como en el
-- resto de las políticas (se evalúa una vez por consulta).

alter policy "documentos_insert_own" on documentos
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from cuentas c where c.id = cuenta_id and c.user_id = (select auth.uid()))
  );
alter policy "documentos_update_own" on documentos
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from cuentas c where c.id = cuenta_id and c.user_id = (select auth.uid()))
  );

alter policy "transacciones_insert_own" on transacciones
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from documentos d where d.id = documento_id and d.user_id = (select auth.uid()))
    and (categoria_id is null
         or exists (select 1 from categorias c where c.id = categoria_id and c.user_id = (select auth.uid())))
    and (evento_id is null
         or exists (select 1 from eventos e where e.id = evento_id and e.user_id = (select auth.uid())))
  );
alter policy "transacciones_update_own" on transacciones
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from documentos d where d.id = documento_id and d.user_id = (select auth.uid()))
    and (categoria_id is null
         or exists (select 1 from categorias c where c.id = categoria_id and c.user_id = (select auth.uid())))
    and (evento_id is null
         or exists (select 1 from eventos e where e.id = evento_id and e.user_id = (select auth.uid())))
  );

alter policy "gastos_correo_insert_own" on gastos_correo
  with check (
    user_id = (select auth.uid())
    and (evento_id is null
         or exists (select 1 from eventos e where e.id = evento_id and e.user_id = (select auth.uid())))
  );
alter policy "gastos_correo_update_own" on gastos_correo
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (evento_id is null
         or exists (select 1 from eventos e where e.id = evento_id and e.user_id = (select auth.uid())))
  );
