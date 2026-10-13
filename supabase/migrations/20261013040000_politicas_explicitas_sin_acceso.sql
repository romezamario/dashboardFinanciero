-- Sugerencia del Security Advisor (2026-10-13): "RLS Enabled No Policy" en
-- administradores y avisos_pago. Sin políticas, RLS ya niega todo a anon y
-- authenticated (y además no tienen permisos sobre esas tablas); solo
-- service_role (que salta RLS) y las funciones del esquema privado las usan.
-- Estas políticas dejan esa intención escrita: nadie las lee ni las escribe
-- por la API.
create policy "administradores_sin_acceso_api" on administradores
  for all to anon, authenticated using (false) with check (false);

create policy "avisos_pago_sin_acceso_api" on avisos_pago
  for all to anon, authenticated using (false) with check (false);
