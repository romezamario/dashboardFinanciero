#!/usr/bin/env bash
# Publica la Bitácora de viajes DENTRO de dashboard-personal, en /viajes/.
#
# Mario (2026-11-26): "Ok muévelo a Dashboard entonces". Igual que Trading, el
# código sigue en su propio repo (romezamario/GestionViajes, ya clonado en
# $VIAJES_DIR por el workflow) y aquí no se edita: en cada despliegue se copia
#   public/     → frontend/dist/viajes/        (página, íconos, sw.js, pdfjs)
#   functions/  → frontend/functions/viajes/   (api/trips, api/files, api/maps…)
#   lib/        → frontend/viajes-lib/         (los imports a lib/ y public/ se reescriben)
# y el KV de los viajes (binding TRIPS, el mismo namespace que usaba
# gestion-viajes, sin mover datos) tiene que estar vinculado a dashboard-personal.
# gestion-viajes-7wo.pages.dev se retiró (2026-11-26): ya no hay proxy de respaldo,
# así que si algo falla el script termina con error y el workflow NO publica
# dashboard-personal (sigue en línea el despliegue anterior).
#
# Contrato entre los dos repos: GestionViajes docs/integracion-dashboard.md.
# Necesita CF_TOKEN, CF_CUENTA y VIAJES_DIR.
set -euo pipefail

PROYECTO="dashboard-personal"
API="https://api.cloudflare.com/client/v4/accounts/${CF_CUENTA}"
FRONT="frontend"

cf() { # cf MÉTODO RUTA [JSON]
  local metodo=$1 ruta=$2 cuerpo=${3:-}
  if [[ -n $cuerpo ]]; then
    curl -sS -X "$metodo" "${API}${ruta}" -H "Authorization: Bearer ${CF_TOKEN}" \
      -H "Content-Type: application/json" --data "$cuerpo"
  else
    curl -sS -X "$metodo" "${API}${ruta}" -H "Authorization: Bearer ${CF_TOKEN}"
  fi
}
resumen() { echo "$*"; echo "$*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }

[[ -f "${VIAJES_DIR}/public/index.html" && -d "${VIAJES_DIR}/functions" ]] || { echo "::error::No está el repo de viajes en ${VIAJES_DIR}"; exit 1; }

# 1. KV: el binding TRIPS (namespace "viajes") debe seguir en dashboard-personal.
actual=$(cf GET "/pages/projects/${PROYECTO}")
kv=$(jq -r '.result.deployment_configs.production.kv_namespaces.TRIPS.namespace_id // empty' <<<"$actual")
[[ -n $kv ]] || { echo "::error::${PROYECTO} no tiene el KV TRIPS vinculado: $(jq -c '.errors' <<<"$actual")"; exit 1; }
echo "${PROYECTO} tiene el KV TRIPS."

# 2. Código: página, Functions y su lib (imports ../../../lib/ → ../../../../viajes-lib/).
rm -rf "${FRONT}/dist/viajes" "${FRONT}/viajes-lib"
mkdir -p "${FRONT}/dist/viajes"
cp -R "${VIAJES_DIR}/public/." "${FRONT}/dist/viajes/"
cp -R "${VIAJES_DIR}/functions" "${FRONT}/functions/viajes"
cp -R "${VIAJES_DIR}/lib" "${FRONT}/viajes-lib"
# Imports que salen de functions/: lib/ → viajes-lib/ y public/ → dist/viajes/ (un nivel más abajo).
find "${FRONT}/functions/viajes" -name '*.js' -print0 | xargs -0 sed -i -E \
  -e 's#(from |import\()(["'"'"'])((\.\./)+)lib/#\1\2../\3viajes-lib/#g' \
  -e 's#(from |import\()(["'"'"'])((\.\./)+)public/#\1\2../\3dist/viajes/#g'
if grep -rqE '(from |import\()["'"'"'](\.\./)+(lib|public)/' "${FRONT}/functions/viajes"; then echo "::error::Quedó un import sin reescribir"; exit 1; fi
# Solo el dueño entra a /viajes/* (los invitados del dashboard no): ver viajes-middleware.ts.
if ls "${FRONT}/functions/viajes/"_middleware.* >/dev/null 2>&1; then echo "::error::GestionViajes ya trae un _middleware en functions/: se pisaría el filtro del dueño"; exit 1; fi
cp "$(dirname "$0")/viajes-middleware.ts" "${FRONT}/functions/viajes/_middleware.ts"

# 3. Mapas oficiales del metro (ATAC Roma), como en el workflow de GestionViajes.
mkdir -p "${FRONT}/dist/viajes/maps"
bajar() {
  if curl -fsSL --retry 3 -A "Mozilla/5.0" -o "${FRONT}/dist/viajes/maps/$1" "$2" && head -c 5 "${FRONT}/dist/viajes/maps/$1" | grep -q '%PDF'; then
    echo "✓ $1"
  else
    rm -f "${FRONT}/dist/viajes/maps/$1"; echo "::warning::No se pudo descargar $1"
  fi
}
bajar roma-metro-ferrovie.pdf "https://www.atac.roma.it/docs/default-source/mappe-tpl/mappa-metro-e-ferrovie-metropolitane.pdf"
bajar roma-metro-esquema.pdf "https://www.atac.roma.it/docs/default-source/mappe-tpl/sinottici-metro-a-b-c-e-rm-gd.pdf"

resumen "✓ Viajes incluido en ${PROYECTO} (GestionViajes $(git -C "${VIAJES_DIR}" rev-parse --short HEAD))."
