#!/usr/bin/env bash
# Prepara el proyecto de Pages `dashboard-personal` (la liga nueva del
# dashboard personal) SIN dejarlo nunca público: termina con error, y el
# workflow se salta el deploy, si no logra ponerlo detrás de Cloudflare Access.
#
# Necesita CF_TOKEN (CLOUDFLARE_API_TOKEN) y CF_CUENTA (CLOUDFLARE_ACCOUNT_ID).
# El token necesita, además de Pages, "Access: Apps and Policies — Edit".
set -euo pipefail

NUEVO="dashboard-personal"
API="https://api.cloudflare.com/client/v4/accounts/${CF_CUENTA}"

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
falla() { resumen "::error::$*"; exit 1; }

# 1. Proyecto (si ya existe, solo se lee).
proyecto=$(cf GET "/pages/projects/${NUEVO}")
if [[ $(jq -r '.success' <<<"$proyecto") != "true" ]]; then
  echo "Creando el proyecto ${NUEVO}…"
  creado=$(cf POST "/pages/projects" "{\"name\":\"${NUEVO}\",\"production_branch\":\"main\"}")
  [[ $(jq -r '.success' <<<"$creado") == "true" ]] || falla "No se pudo crear ${NUEVO}: $(jq -c '.errors' <<<"$creado")"
  proyecto=$(cf GET "/pages/projects/${NUEVO}")
fi
dominio=$(jq -r '.result.subdomain' <<<"$proyecto")
[[ -n $dominio && $dominio != null ]] || falla "No se pudo leer el dominio de ${NUEVO}."
resumen "Dominio del proyecto nuevo: https://${dominio}"

# 2. Access: la aplicación del dashboard debe cubrir el dominio y su comodín.
#    (El proyecto viejo `dashboard-financiero` se borró el 2026-11-26.)
apps=$(cf GET "/access/apps")
[[ $(jq -r '.success' <<<"$apps") == "true" ]] \
  || falla "El token no puede leer las aplicaciones de Access (necesita 'Access: Apps and Policies — Edit'): $(jq -c '.errors' <<<"$apps")"
echo "Aplicaciones de Access visibles: $(jq -r '.result | length' <<<"$apps")"
jq -r '.result[] | "  - \(.name) | \(.domain // "") | \([(.destinations // [])[] | .uri // empty] | join(","))"' <<<"$apps"
app=$(jq -c --arg v "$dominio" '[.result[] | select(([.domain // "", .name // "", ((.self_hosted_domains // [])[]), ((.destinations // [])[] | .uri // "")] | join(" ")) | contains($v))][0]' <<<"$apps")
if [[ $app == null ]]; then
  # El token no tiene permiso de Access (ve 0 aplicaciones): el dominio se
  # agrega a mano en Zero Trust y aquí solo se comprueba (paso 4).
  resumen "::warning::El token no ve aplicaciones de Access; agrega ${dominio} a la aplicación del dashboard en Zero Trust."
else
  # Cada deploy también queda en <hash>.<proyecto>.pages.dev (y las ramas en
  # <rama>.<proyecto>…): sin el comodín esas ligas quedaban SIN Access.
  id_app=$(jq -r '.id' <<<"$app")
  requeridos=$(jq -nc --arg n "$dominio" '[$n, "*." + $n]')
  actuales=$(jq -c '[(.self_hosted_domains // [])[], ((.destinations // [])[] | .uri // empty), .domain] | unique' <<<"$app")
  faltan=$(jq -nc --argjson r "$requeridos" --argjson a "$actuales" '$r - $a')
  if [[ $faltan == "[]" ]]; then
    echo "La aplicación de Access ya cubre ${dominio} y los comodines."
  else
    cuerpo=$(jq -c --argjson f "$faltan" '
      {name, domain, type, session_duration, allowed_idps, auto_redirect_to_identity,
       app_launcher_visible, policies: [(.policies // [])[] | {id, precedence}],
       self_hosted_domains: (((.self_hosted_domains // [.domain]) + $f) | unique),
       destinations: (((.destinations // [{type: "public", uri: .domain}]) + [$f[] | {type: "public", uri: .}]) | unique)}
      | with_entries(select(.value != null))' <<<"$app")
    r=$(cf PUT "/access/apps/${id_app}" "$cuerpo")
    [[ $(jq -r '.success' <<<"$r") == "true" ]] || falla "No se pudo actualizar Access: $(jq -c '.errors' <<<"$r")"
    resumen "Agregué a Access: $(jq -r 'join(", ")' <<<"$faltan")"
  fi
fi

# 3. Comprobación: sin sesión, el dominio nuevo debe mandar al login de Access.
for intento in 1 2 3 4 5 6; do
  destino=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "https://${dominio}/" || true)
  echo "Intento ${intento}: ${destino}"
  if [[ $destino == 30[0-9]*cloudflareaccess.com* ]]; then
    resumen "✓ https://${dominio} pide el login de Cloudflare Access."
    exit 0
  fi
  sleep 10
done
falla "https://${dominio} no redirige a Cloudflare Access; no se despliega ahí."
