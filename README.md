# DepoimentoPro MVP Web

MVP web conectado à base Airtable **DepoimentoPro**.

## O que está implementado

- Cadastro com plano Free e limite inicial de 5 depoimentos.
- Senha armazenada apenas como hash `scrypt` no Airtable.
- Login com sessão assinada em cookie HttpOnly/SameSite.
- Dashboard do usuário.
- Criação de campanhas com token público aleatório.
- Link público usando o domínio de produção da Vercel.
- Formulário público com validação da campanha ativa e do limite do plano.
- Consentimento obrigatório para publicação.
- Depoimento salvo inicialmente como `Pendente`.
- Aprovação/rejeição pelo dashboard.
- Widget público que mostra somente depoimentos aprovados e autorizados.
- Token do Airtable somente no backend.
- Honeypot + limitação básica por IP no formulário público.
- PWA instalável no Android com manifesto, service worker e ícones 192/512.

## Estrutura

- `index.html` — landing e botão de instalação do app.
- `signup.html` / `login.html` — autenticação.
- `dashboard.html` — painel do cliente.
- `form.html` — coleta pública.
- `manifest.webmanifest` — configuração do app instalável.
- `sw.js` — service worker.
- `pwa.js` — instalação do PWA.
- `api/` — funções server-side, incluindo `/api/widget`.
- `lib/` — Airtable, sessão, segurança e utilitários.

## Variáveis de ambiente

Use `.env.example` somente como modelo. Nunca envie um `.env` real ou credenciais ao GitHub.

### Obrigatória
- `AIRTABLE_TOKEN`: PAT com acesso à base DepoimentoPro. **Nunca colocar no frontend.**

### Opcionais no MVP
- `AIRTABLE_BASE_ID`: já possui fallback para a base atual.
- `SESSION_SECRET`: recomendado; se ausente, o backend deriva uma chave de sessão do token server-side.
- `APP_URL`: opcional; na Vercel o app usa automaticamente `VERCEL_PROJECT_PRODUCTION_URL` para gerar os links públicos.

## Deploy na Vercel

1. Conecte este repositório ao projeto Vercel.
2. Mantenha `AIRTABLE_TOKEN` como variável Secret de Production.
3. Faça o deploy.
4. Teste `/signup` → `/dashboard` → criar campanha → abrir formulário em aba anônima → enviar depoimento → aprovar.
5. Teste `/widget?user=<record_id>` para confirmar a exibição somente dos depoimentos aprovados e consentidos.
6. No Android/Chrome, abra a landing e use **Instalar app** quando o navegador oferecer a instalação.

## Segurança antes de abrir para público

O MVP evita expor o PAT do Airtable, usa senha com hash e exige consentimento. O rate limit em memória é apenas uma primeira barreira e não é distribuído entre todas as instâncias serverless. Antes do soft launch público, ativar captcha, revisar Termos/Privacidade e configurar backup/monitoramento.

## Limitação conhecida do Airtable

A criação do depoimento e a atualização dos contadores são chamadas separadas; Airtable não oferece transação atômica nesse fluxo. Para poucos usuários do MVP é aceitável, mas na escala essa lógica deve migrar para backend/banco com transações.
