# Rate limiting

O DepoimentoPro usa `lib/rate-limit.js` como camada única de proteção contra abuso.

## Produção

Configure na Vercel:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Quando as duas variáveis existem, os contadores são compartilhados entre instâncias serverless via Upstash Redis REST. As chaves armazenadas usam hash SHA-256 truncado; e-mail, IP e record IDs não são gravados em texto puro no Redis.

Se o Redis estiver indisponível, o código cai temporariamente para o limiter em memória. Esse fallback preserva disponibilidade, mas não oferece proteção distribuída e deve ser monitorado.

## Limites atuais

- Signup por IP: 5 / 15 min
- Login por IP: 12 / 15 min
- Login por conta: 6 / 15 min
- Depoimento público por IP: 6 / min
- Criação de campanha por usuário: 20 / 10 min
- Moderação/exclusão por usuário: 60 / 5 min
- Criação/obtenção de widget por usuário: 10 / 10 min

Respostas bloqueadas usam HTTP `429` e `Retry-After`.

## Desenvolvimento e testes

Sem as variáveis Upstash, o sistema usa memória local. Isso é intencional para não exigir Redis durante desenvolvimento.

## Observação

O rate limiter reduz abuso, mas não torna os contadores de plano do Airtable atômicos. Essa limitação continua separada e será resolvida em uma futura migração para banco transacional.
