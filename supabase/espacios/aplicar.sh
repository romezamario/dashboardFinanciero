#!/usr/bin/env bash
# Aplica las migraciones de los espacios del dashboard personal (Salud, y los
# que vengan: Viajes, Pendientes...) a la instancia PERSONAL de Supabase.
#
# Por qué no van en supabase/migrations: esas se aplican también a la
# instancia de clientes (Ordena tu Lana). Cada espacio es una carpeta
# supabase/espacios/<espacio>/migraciones/ y vive en su propio esquema de
# Postgres con el mismo nombre que la carpeta.
#
# Cómo: por la API de administración de Supabase (el mismo endpoint SQL que
# usa "Sincronizar invitados"). Lleva su propio registro en
# control_espacios.migraciones (esquema sin acceso desde la API) y corre cada
# archivo nuevo dentro de una transacción junto con su registro, así un error
# no deja nada a medias y la siguiente corrida lo reintenta. Al final expone
# los esquemas de los espacios en la API REST (PostgREST), sin quitar los que
# ya estaban.
#
# Uso: SUPABASE_ACCESS_TOKEN=... PROYECTO=<ref> supabase/espacios/aplicar.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")" && pwd)"
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN}"
: "${PROYECTO:?Falta PROYECTO}"
API="https://api.supabase.com/v1/projects/$PROYECTO"

# Esquemas que un espacio no puede usar como nombre.
RESERVADOS=" public privado auth storage extensions graphql graphql_public realtime vault pgsodium supabase_functions supabase_migrations control_espacios "

llamar() { # metodo ruta [cuerpo-json] -> imprime el cuerpo; falla si no es 2xx
  local respuesta codigo
  if [ $# -ge 3 ]; then
    respuesta=$(printf '%s' "$3" | curl -sS -w '\n%{http_code}' -X "$1" "$API$2" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @-)
  else
    respuesta=$(curl -sS -w '\n%{http_code}' -X "$1" "$API$2" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")
  fi
  codigo=$(printf '%s' "$respuesta" | tail -n1)
  if [ "${codigo:0:1}" != "2" ]; then
    echo "::error::$1 $2 respondió HTTP $codigo" >&2
    printf '%s\n' "$respuesta" | head -n -1 >&2
    return 1
  fi
  printf '%s' "$respuesta" | head -n -1
}

sql() { llamar POST /database/query "$(jq -n --arg q "$1" '{query: $q}')"; }

sql "create schema if not exists control_espacios;
revoke all on schema control_espacios from public, anon, authenticated;
create table if not exists control_espacios.migraciones (
  espacio text not null,
  archivo text not null,
  aplicada_en timestamptz not null default now(),
  primary key (espacio, archivo)
);" > /dev/null

aplicadas=$(sql "select espacio || '/' || archivo as clave from control_espacios.migraciones;" | jq -r '.[].clave')

espacios=()
nuevas=0
for carpeta in "$RAIZ"/*/; do
  [ -d "$carpeta/migraciones" ] || continue
  espacio=$(basename "$carpeta")
  if ! [[ "$espacio" =~ ^[a-z][a-z0-9_]*$ ]] || [[ "$RESERVADOS" == *" $espacio "* ]]; then
    echo "::error::Nombre de espacio no válido: $espacio" >&2
    exit 1
  fi
  espacios+=("$espacio")
  for archivo_sql in $(find "$carpeta/migraciones" -maxdepth 1 -name '*.sql' | sort); do
    archivo=$(basename "$archivo_sql")
    if ! [[ "$archivo" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
      echo "::error::Nombre de migración no válido: $espacio/$archivo (AAAAMMDDHHMMSS_nombre.sql)" >&2
      exit 1
    fi
    if grep -qxF "$espacio/$archivo" <<< "$aplicadas"; then continue; fi
    echo "Aplicando $espacio/$archivo"
    sql "begin;
$(cat "$archivo_sql")
;
insert into control_espacios.migraciones (espacio, archivo) values ('$espacio', '$archivo');
commit;" > /dev/null
    nuevas=$((nuevas + 1))
  done
done
echo "Migraciones de espacios aplicadas: $nuevas"

[ ${#espacios[@]} -gt 0 ] || exit 0

# Exponer los esquemas en la API REST, conservando los que ya estaban.
actual=$(llamar GET /postgrest | jq -r '.db_schema')
nuevo="$actual"
for espacio in "${espacios[@]}"; do
  if ! tr ',' '\n' <<< "$actual" | sed 's/^ *//; s/ *$//' | grep -qxF "$espacio"; then
    nuevo="$nuevo,$espacio"
  fi
done
if [ "$nuevo" != "$actual" ]; then
  llamar PATCH /postgrest "$(jq -n --arg s "$nuevo" '{db_schema: $s}')" > /dev/null
  echo "Esquemas expuestos en la API: $nuevo"
else
  echo "Esquemas expuestos sin cambios: $actual"
fi
