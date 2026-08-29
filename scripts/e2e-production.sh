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
  if [[ "$method" != "GET" ]]; then
    args+=(-H 'Content-Type: application/json')
  fi
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

echo "E2E_EMAIL=$EMAIL"
echo "BASE_URL=$BASE_URL"

echo '1/11 Smoke das páginas públicas'
for path in / /login /signup; do
  code="$(curl -sS -o /tmp/dpro-page.html -w '%{http_code}' "$BASE_URL$path")"
  [[ "$code" == "200" ]] || { echo "FAIL GET $path -> $code"; head -c 500 /tmp/dpro-page.html; exit 1; }
done

echo '2/11 Cadastro e sessão'
body="$(jq -nc --arg nome 'E2E Automático' --arg email "$EMAIL" --arg password "$PASSWORD" '{nome:$nome,email:$email,password:$password}')"
code="$(request_json POST "$BASE_URL/api/signup" "$body" save)"
expect_status "$code" 201 signup
jq -e '.user.email' /tmp/dpro-response.json >/dev/null

code="$(request_json GET "$BASE_URL/api/dashboard" '' send)"
expect_status "$code" 200 dashboard
jq -e '.user.plano == "Free"' /tmp/dpro-response.json >/dev/null

echo '3/11 Criação de campanha autenticada'
body="$(jq -nc --arg nome "$CAMPAIGN_NAME" --arg w 'Oi! Pode deixar um depoimento rápido?' '{nome:$nome,mensagemEmail:"",mensagemWhatsApp:$w}')"
code="$(request_json POST "$BASE_URL/api/campaigns" "$body" send same)"
expect_status "$code" 201 campaign
LINK="$(jq -r '.campaign.link' /tmp/dpro-response.json)"
TOKEN="$(python3 -c 'import sys, urllib.parse as u; q=u.parse_qs(u.urlparse(sys.argv[1]).query); print(q.get("token",[""])[0])' "$LINK")"
[[ ${#TOKEN} -ge 20 ]] || { echo 'FAIL token de campanha ausente'; cat /tmp/dpro-response.json; exit 1; }
echo "CAMPAIGN_LINK=$LINK"

echo '4/11 Formulário público'
code="$(curl -sS -o /tmp/dpro-form.html -w '%{http_code}' "$BASE_URL/form?token=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$TOKEN")")"
[[ "$code" == "200" ]] || { echo "FAIL form HTML -> $code"; exit 1; }
code="$(request_json GET "$BASE_URL/api/public-campaign?token=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$TOKEN")")"
expect_status "$code" 200 public-campaign
TURNSTILE_SITE_KEY="$(jq -r '.turnstileSiteKey // empty' /tmp/dpro-response.json)"
if [[ -n "$TURNSTILE_SITE_KEY" ]]; then
  echo 'FAIL Turnstile está ativo em produção; o robô E2E não deve burlar CAPTCHA. Fazer este passo manualmente.'
  exit 2
fi

echo '5/11 Envio de depoimento público'
body="$(jq -nc --arg token "$TOKEN" --arg nome 'Cliente E2E' --arg texto "$TESTIMONIAL_TEXT" '{token:$token,nomeCliente:$nome,texto:$texto,nota:5,consentimento:true,website:""}')"
code="$(request_json POST "$BASE_URL/api/testimonials" "$body")"
expect_status "$code" 201 testimonial

echo '6/11 Confirmação de pendência no dashboard'
code="$(request_json GET "$BASE_URL/api/dashboard" '' send)"
expect_status "$code" 200 dashboard-after-submit
TESTIMONIAL_ID="$(jq -r --arg t "$TESTIMONIAL_TEXT" '.testimonials[] | select(.texto==$t) | .id' /tmp/dpro-response.json | head -n1)"
[[ "$TESTIMONIAL_ID" =~ ^rec[A-Za-z0-9]{14}$ ]] || { echo 'FAIL depoimento não apareceu no dashboard'; cat /tmp/dpro-response.json; exit 1; }
STATUS="$(jq -r --arg id "$TESTIMONIAL_ID" '.testimonials[] | select(.id==$id) | .status' /tmp/dpro-response.json)"
[[ "$STATUS" == "Pendente" ]] || { echo "FAIL status esperado Pendente, recebido $STATUS"; exit 1; }

echo '7/11 Aprovação autenticada'
body="$(jq -nc --arg id "$TESTIMONIAL_ID" '{testimonialId:$id,status:"Aprovado"}')"
code="$(request_json POST "$BASE_URL/api/moderate" "$body" send same)"
expect_status "$code" 200 moderate-approve

echo '8/11 Criação/obtenção do widget'
code="$(request_json POST "$BASE_URL/api/widgets" '{}' send same)"
expect_status "$code" 200 widget-create
WIDGET_TOKEN="$(jq -r '.widget.token' /tmp/dpro-response.json)"
[[ ${#WIDGET_TOKEN} -ge 24 ]] || { echo 'FAIL token de widget ausente'; cat /tmp/dpro-response.json; exit 1; }

echo '9/11 Widget publica apenas aprovado + consentido'
WIDGET_URL="$BASE_URL/widget?token=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$WIDGET_TOKEN")"
code="$(curl -sS -o /tmp/dpro-widget.html -w '%{http_code}' "$WIDGET_URL")"
[[ "$code" == "200" ]] || { echo "FAIL widget -> $code"; exit 1; }
grep -Fq "$TESTIMONIAL_TEXT" /tmp/dpro-widget.html || { echo 'FAIL depoimento aprovado não apareceu no widget'; cat /tmp/dpro-widget.html; exit 1; }

echo '10/11 Retirada de consentimento'
body="$(jq -nc --arg id "$TESTIMONIAL_ID" '{testimonialId:$id,withdrawConsent:true}')"
code="$(request_json POST "$BASE_URL/api/moderate" "$body" send same)"
expect_status "$code" 200 withdraw-consent

# Primeira leitura sem cache-bust mede o comportamento real do embed existente.
code="$(curl -sS -o /tmp/dpro-widget-after.html -w '%{http_code}' "$WIDGET_URL")"
[[ "$code" == "200" ]] || { echo "FAIL widget após retirada -> $code"; exit 1; }
if grep -Fq "$TESTIMONIAL_TEXT" /tmp/dpro-widget-after.html; then
  echo 'FAIL CACHE_STALE: depoimento continua visível no mesmo URL após retirada de consentimento.'
  exit 3
fi

echo '11/11 Validação final do dashboard'
code="$(request_json GET "$BASE_URL/api/dashboard" '' send)"
expect_status "$code" 200 dashboard-final
CONSENT="$(jq -r --arg id "$TESTIMONIAL_ID" '.testimonials[] | select(.id==$id) | .consentimento' /tmp/dpro-response.json)"
[[ "$CONSENT" == "false" ]] || { echo "FAIL consentimento esperado false, recebido $CONSENT"; exit 1; }

echo 'E2E_OK=1'
echo "TEST_USER=$EMAIL"
echo "TESTIMONIAL_ID=$TESTIMONIAL_ID"
echo "WIDGET_TOKEN=$WIDGET_TOKEN"
