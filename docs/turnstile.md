# Cloudflare Turnstile

O formulário público suporta Turnstile de forma opcional.

Variáveis: `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY`.

A proteção só é obrigatória no backend quando `TURNSTILE_SECRET_KEY` estiver configurado. Quando isso acontece, `public-campaign` devolve a site key e o formulário carrega o widget do Turnstile. Nunca envie o secret ao frontend ou ao GitHub.

É possível testar o MVP sem Turnstile. Antes de divulgação ampla, configure as duas variáveis na Vercel e refaça o teste E2E do formulário público.
