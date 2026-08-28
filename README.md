# DepoimentoPro MVP Web

MVP web conectado à base Airtable **DepoimentoPro**.

## O que está implementado

- Cadastro com plano Free e limite inicial de 5 depoimentos.
- Senha armazenada apenas como hash `scrypt` no Airtable.
- Login com sessão assinada em cookie HttpOnly/SameSite.
- Dashboard do usuário.
- Criação de campanhas com token público aleatório.
- Link público sem expor record ID do Airtable.
- Formulário público com validação da campanha ativa e do limite do plano.
- Consentimento obrigatório para publicação.
- Depoimento salvo inicialmente como `Pendente`.
- Aprovação/rejeição pelo dashboard.
- Token do Airtable somente no backend.
- Honeypot + limitação básica por IP no formulário público.
- PWA instalável no Android com manifesto, service worker e ícones.

## Estrutura

- `index.html` — landing.
- `signup.html` / `login.html` — autenticação.
- `dashboard.html` — painel do cliente.
- `form.html` — coleta pública.
- `manifest.webmanifest` — configuração do app instalável.
- `sw.js` — service worker.
- `pwa.js` — instalação do PWA.
- `api/` — funções server-side.
- `lib/` — Airtable, sessão, segurança e utilitários.

## Variáveis obrigatórias

Use `.env.example` somente como modelo e configure os valores reais na Vercel. Nunca envie `.env` ao GitHub.

- `AIRTABLE_TOKEN`: PAT com acesso à base DepoimentoPro. **Nunca colocar no frontend.**
- `AIRTABLE_BASE_ID`: ID da base.
- `SESSION_SECRET`: string aleatória com pelo menos 32 caracteres.
- `APP_URL`: URL pública do app.

## Deploy sugerido

O projeto foi preparado para Vercel com arquivos estáticos na raiz e funções dentro de `/api`.

1. Importe este repositório na Vercel.
2. Configure as variáveis de ambiente de produção.
3. Faça o deploy.
4. Crie uma conta de teste em `/signup`.
5. Crie uma campanha, abra o link público em aba anônima e envie um depoimento.
6. Volte ao dashboard e aprove/rejeite o depoimento.
7. No Android/Chrome, use a opção de instalar/adicionar à tela inicial para usar como app.

## Segurança antes de abrir para público

O MVP já evita expor o PAT do Airtable, usa senha com hash e exige consentimento. O rate limit em memória é apenas uma primeira barreira e não é distribuído entre todas as instâncias serverless. Antes do soft launch público, ativar captcha, revisar Termos/Privacidade e configurar backup/monitoramento.

## Limitação conhecida do Airtable

A criação do depoimento e a atualização dos contadores são chamadas separadas; Airtable não oferece transação atômica nesse fluxo. Para poucos usuários do MVP é aceitável, mas na escala essa lógica deve migrar para backend/banco com transações.
