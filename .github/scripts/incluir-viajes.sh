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
# gestion-viajes, sin mover datos) se vincula a dashboard-personal.
# Así /viajes/ ya no pasa por gestion-viajes-7wo.pages.dev.
#
# Si algo falla, se deja todo como estaba: el proxy functions/viajes/[[ruta]].ts
# sigue reenviando a 7wo, y el resto del dashboard se publica igual.
#
# Necesita CF_TOKEN, CF_CUENTA y VIAJES_DIR.
set -euo pipefail

PROYECTO="dashboard-personal"
PROYECTO_VIAJES="gestion-viajes"
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

deshacer() {
  rm -rf "${FRONT}/dist/viajes" "${FRONT}/viajes-lib" "${FRONT}/functions/viajes"
  git checkout -- "${FRONT}/functions/viajes"
  resumen "::warning::Viajes sigue por el proxy a gestion-viajes (no se pudo incluir aquí)."
}
trap 'deshacer' ERR

[[ -f "${VIAJES_DIR}/public/index.html" && -d "${VIAJES_DIR}/functions" ]] || { echo "No está el repo de viajes en ${VIAJES_DIR}"; false; }

# 1. KV: el namespace que hoy usa gestion-viajes como TRIPS.
actual=$(cf GET "/pages/projects/${PROYECTO}")
kv=$(jq -r '.result.deployment_configs.production.kv_namespaces.TRIPS.namespace_id // empty' <<<"$actual")
if [[ -z $kv ]]; then
  viajes=$(cf GET "/pages/projects/${PROYECTO_VIAJES}")
  kv=$(jq -r '.result.deployment_configs.production.kv_namespaces.TRIPS.namespace_id // empty' <<<"$viajes")
  [[ -n $kv ]] || { echo "No encontré el KV TRIPS de ${PROYECTO_VIAJES}: $(jq -c '.errors' <<<"$viajes")"; false; }
  r=$(cf PATCH "/pages/projects/${PROYECTO}" "{\"deployment_configs\":{\"production\":{\"kv_namespaces\":{\"TRIPS\":{\"namespace_id\":\"${kv}\"}}}}}")
  [[ $(jq -r '.success' <<<"$r") == "true" ]] || { echo "No se pudo vincular el KV: $(jq -c '.errors' <<<"$r")"; false; }
  resumen "Vinculé el KV de viajes (TRIPS) a ${PROYECTO}."
else
  echo "${PROYECTO} ya tiene el KV TRIPS."
fi

# 2. Código: página, Functions y su lib (imports ../../../lib/ → ../../../../viajes-lib/).
rm -rf "${FRONT}/functions/viajes" "${FRONT}/dist/viajes" "${FRONT}/viajes-lib"
mkdir -p "${FRONT}/dist/viajes"
cp -R "${VIAJES_DIR}/public/." "${FRONT}/dist/viajes/"
cp -R "${VIAJES_DIR}/functions" "${FRONT}/functions/viajes"
cp -R "${VIAJES_DIR}/lib" "${FRONT}/viajes-lib"
# Imports que salen de functions/: lib/ → viajes-lib/ y public/ → dist/viajes/ (un nivel más abajo).
find "${FRONT}/functions/viajes" -name '*.js' -print0 | xargs -0 sed -i -E \
  -e 's#(from |import\()(["'"'"'])((\.\./)+)lib/#\1\2../\3viajes-lib/#g' \
  -e 's#(from |import\()(["'"'"'])((\.\./)+)public/#\1\2../\3dist/viajes/#g'
if grep -rqE '(from |import\()["'"'"'](\.\./)+(lib|public)/' "${FRONT}/functions/viajes"; then echo "Quedó un import sin reescribir"; false; fi

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

trap - ERR
resumen "✓ Viajes incluido en ${PROYECTO} (GestionViajes $(git -C "${VIAJES_DIR}" rev-parse --short HEAD))."
