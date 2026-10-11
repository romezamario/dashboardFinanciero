#!/usr/bin/env bash
# Aplica todas las migraciones a una base vacía y corre las pruebas de RLS.
# Usa las variables estándar de psql (PGHOST, PGPORT, PGUSER, PGPASSWORD).
# La base de prueba se borra y se vuelve a crear: nunca apuntes esto a
# Supabase, solo a un Postgres desechable (CI o local).
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE_PRUEBAS:-pruebas_rls}"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $BASE" -c "create database $BASE"
psql -v ON_ERROR_STOP=1 -q -d "$BASE" -f tests/stub_supabase.sql
for migracion in migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$BASE" -f "$migracion"
done
psql -v ON_ERROR_STOP=1 -q -d "$BASE" -f tests/aislamiento.sql
