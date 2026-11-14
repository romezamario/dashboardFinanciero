-- Quitar el espejo de eventos del anillo (2026-11-14, auditoría del espacio
-- Salud; Mario aprobó "dejar de subir esa tabla y borrarla"). El colector subía
-- cada evento decodificado de oura.db (~31,000 renglones al día, 186k en 6
-- días) y ningún panel lo leía: todo sale de `resumen_diario`. A ese ritmo
-- llenaba los 500 MB gratis de Supabase, que comparte proyecto con Finanzas.
-- Los eventos siguen completos en datos\oura.db de la laptop; el colector
-- (repo oura, ca20437) ya no los sube. La columna
-- `oura_sincronizaciones.eventos_enviados` se queda (default 0) para no
-- tocar filas viejas.
drop table if exists salud.oura_eventos;
