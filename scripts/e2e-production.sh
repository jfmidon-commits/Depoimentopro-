#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://depoimentopro-app.vercel.app}"
COOKIE_JAR="$(mktemp)"
TS="$(date +%s)"
EMAIL="e2e-${GITHUB_RUN_ID:-local}-${TS}@example.com"
PASSWORD="TesteE2E2026x!"
CAMPAIGN_NAME="E2E Soft Launch ${TS}"
TESTIMONIAL_TEXT="Depoimento E2E automático ${TS}"

cleanup_local() {
  rm -f "$COOKIE_JAR" /tmp/dpro-*.json /tmp/dpro-*.html
}
trap cleanup_local EXIT

request_json() {
  local method="$1" url="$2" body="${3:-}" cookie_mode="${4:-none}" origin_mode="${5:-none}"
  local args=(-sS -o /tmp/dpro-response.json -w '%{http_code}' -X "$method" -H 'Accept: application/json')
  if [[ "$method" != "GET" ]]; then args+=(-H 'Content-Type: application/json'); fi
  if [[ "$cookie_mode" == "save" ]]; then args+=(-c "$COOKIE_JAR"); fi
  if [[ "$cookie_mode" == "send" ]]; then args+=(-b "$COOKIE_JAR"); fi
  if [[ "$origin_mode" == "same" ]]; then args+=(-H "Origin: $BASE_URL"); fi
  if [[ -n "$body" ]]; then args+=(-d "$body"); fi
  curl "${args[@]}" "$url"
}

expect_status() {
  local got="$1" expected="$2" step="$3"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL [$step] esperado HTTP $expected, recebido $got"
    cat /tmp/dpro-response.json || true
    exit 1
  fi
}

echo "BASE_URL=$BASE_URL"

echo '0/12 Health e versão'
code="$(request_json GET "$BASE_URL/api/health")"
expect_status "$code" 200 health
jq -e '.ok == true and .service == "depoimentopro"' /tmp/dpro-response.json >/dev/null

echo '1/12 Smoke das páginas públicas'
for path in / /login /signup; do
  code="$(curl -sS -o /tmp/dpro-page.html -w '%{http_code}' "$BASE_URL$path")"
  [[ "$code" == "200" ]] || { echo "FAIL GET $path -> $code"; head -c 500 /tmp/dpro-page.html; exit 1; }
done

echo '2/12 Cadastro e sessão'
body="$(jq -nc --arg nome 'E2E Automático' --arg email "$EMAIL" --arg password "$PASSWORD" '{nome:$nome,email:$email,password:$password}')"
code="$(request_json POST "$BASE_URL/api/signup" "$body" save same)"
expect_status "$code" 201 signup
jq -e '.user.email' /tmp/dpro-response.json >/dev/null

code="$(request_json GET "$BASE_URL/api/dashboard" '' send)"
expect_status "$code" 200 dashboard
jq -e '.user.plano == "Free"' /tmp/dpro-response.json >/dev/null

echo '3/12 Criação de campanha autenticada'
body="$(jq -nc --arg nome "$CAMPAIGN_NAME" --arg w 'Oi! Pode deixar um depoimento rápido?' '{nome:$nome,mensagemEmail:"",mensagemWhatsApp:$w}')"
code="$(request_json POST "$BASE_URL/api/campaigns" "$body" send same)"
expect_status "$code" 201 campaign
LINK="$(jq -r '.campaign.link' /tmp/dpro-response.json)"
TOKEN="$(python3 -c 'import sys, urllib.parse as u; q=u.parse_qs(u.urlparse(sys.argv[1]).query); print(q.get("token",[""])[0])' "$LINK")"
[[ ${#TOKEN} -ge 20 ]] || { echo 'FAIL token de campanha ausente'; exit 1; }

echo '4/12 Formulário público'
code="$(request_json GET "$BASE_URL/api/public-campaign?token=$TOKEN")"
expect_status "$code" 200 public-campaign
TURNSTILE_SITE_KEY="$(jq -r '.turnstileSiteKey // empty' /tmp/dpro-response.json)"
if [[ -n "$TURNSTILE_SITE_KEY" ]]; then
  echo 'SKIP: Turnstile ativo; o E2E não deve burlar CAPTCHA.'
  exit 2
fi

echo '5/12 Envio de depoimento público'
body="$(jq -nc --arg token "$TOKEN" --arg nome 'Cliente E2E' --arg texto "$TESTIMONIAL_TEXT" '{token:$token,nomeCliente:$nome,texto:$texto,nota:5,consentimento:true,website:""}')"
code="$(request_json POST "$BASE_URL/api/testimonials" "$body")"
expect_status "$code" 201 testimonial

echo '6/12 Confirmação de pendência'
code="$(request_json GET "$BASE_URL/api/dashboard" '' send)"
expect_status "$code" 200 dashboard-after-submit
TESTIMONIAL_ID="$(jq -r --arg t "$TESTIMONIAL_TEXT" '.testimonials[] | select(.texto==$t) | .id' /tmp/dpro-response.json | head -n1)"
[[ "$TESTIMONIAL_ID" =~ ^rec[A-Za-z0-9]{14}$ ]] || { echo 'FAIL depoimento não apareceu'; exit 1; }

echo '7/12 Aprovação autenticada'
body="$(jq -nc --arg id "$TESTIMONIAL_ID" '{testimonialId:$id,status:"Aprovado"}')"
code="$(request_json POST "$BASE_URL/api/moderate" "$body" send same)"
expect_status "$code" 200 moderate-approve

echo '8/12 Criação/obtenção do widget'
code="$(request_json POST "$BASE_URL/api/widgets" '{}' send same)"
expect_status "$code" 200 widget-create
WIDGET_TOKEN="$(jq -r '.widget.token' /tmp/dpro-response.json)"
[[ ${#WIDGET_TOKEN} -ge 24 ]] || { echo 'FAIL token de widget ausente'; exit 1; }

echo '9/12 Widget publica aprovado + consentido'
WIDGET_URL="$BASE_URL/widget?token=$WIDGET_TOKEN"
code="$(curl -sS -o /tmp/dpro-widget.html -w '%{http_code}' "$WIDGET_URL")"
[[ "$code" == "200" ]] || { echo "FAIL widget -> $code"; exit 1; }
grep -Fq "$TESTIMONIAL_TEXT" /tmp/dpro-widget.html || { echo 'FAIL depoimento não apareceu no widget'; exit 1; }

echo '10/12 Retirada de consentimento'
body="$(jq -nc --arg id "$TESTIMONIAL_ID" '{testimonialId:$id,withdrawConsent:true}')"
code="$(request_json POST "$BASE_URL/api/moderate" "$body" send same)"
expect_status "$code" 200 withdraw-consent

code="$(curl -sS -o /tmp/dpro-widget-after.html -w '%{http_code}' "$WIDGET_URL")"
[[ "$code" == "200" ]] || { echo "FAIL widget após retirada -> $code"; exit 1; }
if grep -Fq "$TESTIMONIAL_TEXT" /tmp/dpro-widget-after.html; then
  echo 'FAIL: depoimento continua visível após retirada de consentimento.'
  exit 3
fi

echo '11/12 Validação final'
code="$(request_json GET "$BASE_URL/api/dashboard" '' send)"
expect_status "$code" 200 dashboard-final
CONSENT="$(jq -r --arg id "$TESTIMONIAL_ID" '.testimonials[] | select(.id==$id) | .consentimento' /tmp/dpro-response.json)"
[[ "$CONSENT" == "false" ]] || { echo "FAIL consentimento esperado false, recebido $CONSENT"; exit 1; }

echo '12/12 E2E_OK=1'
