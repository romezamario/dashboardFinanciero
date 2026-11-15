-- Salud (auditoría 2026-11-14, M2): el dashboard bajaba TODA la historia con
-- el hipnograma (`noche.stages`) y la FC/HRV minuto a minuto
-- (`noche.series_t`) de cada noche, aunque solo los dibuja para la noche
-- elegida. Esta vista da los mismos días sin esas dos series; el dashboard la
-- usa para los días viejos y pide la fila completa de una noche solo cuando
-- la abres.
--
-- security_invoker: la vista aplica la RLS de resumen_diario con el usuario
-- que consulta (solo el dueño ve sus filas), no la del creador de la vista.

create view salud.resumen_ligero with (security_invoker = true) as
select
  user_id,
  fecha,
  fuente,
  case
    when jsonb_typeof(datos -> 'noche') = 'object'
      then jsonb_set(datos, '{noche}', (datos -> 'noche') - 'stages' - 'series_t')
    else datos
  end as datos
from salud.resumen_diario;

grant select on salud.resumen_ligero to authenticated;
grant select on salud.resumen_ligero to service_role;
