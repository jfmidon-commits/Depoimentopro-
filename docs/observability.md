# Observabilidade

O MVP usa logs JSON via `lib/logger.js` e `X-Request-Id` para correlação de falhas.

## Request ID

Rotas críticas geram um UUID por requisição e devolvem `X-Request-Id`. Esse ID pode ser usado para localizar a mesma falha nos logs da Vercel.

## Redaction

O logger remove ou mascara chaves e valores sensíveis, incluindo senhas, tokens, cookies, authorization headers, e-mails, nomes, textos de depoimento e mensagens. O código não deve enviar body completo de requisição ao logger.

## Logs

Eventos de erro são registrados em JSON com:

- timestamp
- level
- event
- requestId
- route
- nome/mensagem sanitizada do erro

Falhas do Redis geram aviso `rate_limit.redis_fallback` no máximo uma vez por minuto por instância.

## Health

`GET /api/health` informa somente:

- `ok`
- serviço
- versão do commit
- backend de rate limit configurado (`redis` ou `memory`)
- Turnstile ativo ou não

Nenhum valor secreto é retornado.

## Sentry

`SENTRY_DSN` está reservado para uma integração futura. Nesta etapa não há SDK Sentry instalado; não considerar Sentry ativo apenas por definir a variável.

## Investigação na Vercel

1. localizar o horário/erro informado pelo usuário;
2. buscar o `X-Request-Id` nos logs da Function;
3. correlacionar com `event` e `route`;
4. verificar 429/fallback de Redis antes de tratar como erro de aplicação;
5. nunca copiar secrets ou corpos completos de requisições para tickets.
