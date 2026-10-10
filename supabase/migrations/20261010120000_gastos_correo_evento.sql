-- Evento (viaje, fiesta, Shophunters...) asignado a un gasto del correo desde
-- "Gastos recientes", para categorizarlo el mismo día en vez de esperar al
-- estado de cuenta. Cuando el estado de cuenta llega y su cargo se empareja con
-- este aviso (mismo monto, ±1 día), el frontend ofrece heredar este evento al
-- movimiento del estado de cuenta.
--
-- Misma forma que `transacciones.evento_id` (FK al catálogo `eventos`, que se
-- llena con find-or-create por nombre). La subida desde la app de escritorio
-- (upsert de `gastos_correo`) no envía esta columna, así que volver a subir un
-- día conserva el evento, igual que con `transacciones`.
--
-- Las políticas de gastos_correo ya cubren este update (user_id = auth.uid()).
alter table gastos_correo add column evento_id uuid references eventos(id);

create index idx_gastos_correo_evento on gastos_correo (user_id, evento_id);
