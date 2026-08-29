# Cloudflare Turnstile

O formulário público suporta Turnstile de forma opcional.

Variáveis: `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY`.

A proteção só é ativada quando **as duas variáveis** estiverem configuradas. Com a configuração completa, `public-campaign` devolve apenas a site key ao navegador e o backend valida cada resposta com o secret. O secret nunca deve ir para o frontend ou para o GitHub.

Se apenas uma das duas variáveis existir, o Turnstile permanece desativado para evitar indisponibilidade do formulário por configuração incompleta.

É possível testar o MVP sem Turnstile. Antes de divulgação ampla, configure as duas variáveis na Vercel e refaça o teste E2E do formulário público.
