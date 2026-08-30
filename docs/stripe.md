# Stripe — Test Mode e billing readiness

O código de billing está preparado para Stripe Test Mode. Cobrança real permanece bloqueada até configuração e aprovação explícitas.

## Planos
- Free — R$ 0 — 5 depoimentos.
- Starter — R$ 47/mês — 50 depoimentos **provisórios; confirmar comercialmente antes de cobrança pública**.
- Pro — R$ 97/mês — ilimitado no produto.

Os limites vivem em `lib/plans.js`. O frontend não define preço nem entitlement. Plano pago só é efetivo quando existe `Stripe Subscription ID` e o status atual concede entitlement.

## Arquitetura
Para respeitar o limite de Functions do Vercel Hobby, existe uma única Function `api/billing.js`. O `vercel.json` mantém URLs semânticas por rewrite:
- `POST /api/billing-checkout` → checkout;
- `POST /api/billing-portal` → Customer Portal;
- `POST /api/billing-webhook` → webhook Stripe.

Checkout e Portal exigem sessão, same-origin/CSRF e rate limit. O webhook não usa sessão nem CSRF; exige corpo bruto, assinatura `Stripe-Signature` válida e compatibilidade Test/Live com a chave configurada.

## Variáveis
```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
APP_URL=https://depoimentopro-app.vercel.app
BILLING_LIVE_ENABLED=false
```

Uma `sk_live_` continua bloqueada enquanto `BILLING_LIVE_ENABLED` não for exatamente `true`. A proteção vale também para chamadas de reconciliação Stripe, não apenas Checkout/Portal.

## Checkout
O browser envia somente `plan: starter|pro`. Qualquer `priceId` enviado pelo cliente é rejeitado. O servidor mapeia o plano para `STRIPE_PRICE_STARTER`/`STRIPE_PRICE_PRO`.

Antes de reutilizar `Stripe Customer ID`, o backend consulta a Stripe e confirma `metadata.dpro_user_id` do próprio usuário. Customer de outro usuário é rejeitado.

Um usuário com subscription não terminal (`active`, `trialing`, `past_due`, `paused`, `incomplete` ou estado desconhecido vinculado) **não pode abrir um segundo Checkout de assinatura**. Alterações de plano/forma de pagamento devem ser feitas pelo Customer Portal/configuração Stripe. Isso evita assinaturas paralelas e dupla cobrança.

O campo `Plano` não muda no Checkout. `checkout.session.completed` faz somente linkage seguro de Customer; não concede plano pago e não sobrescreve a subscription atual.

## Webhooks suportados
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

A Stripe não garante ordem de entrega de webhooks. Para `subscription.created`/`updated` e eventos de invoice com subscription, o backend recupera o snapshot atual da subscription pela API Stripe antes de atualizar entitlement. Um evento atrasado de uma subscription antiga não pode substituir uma subscription atual não terminal. `subscription.deleted` só afeta o usuário quando corresponde à subscription atualmente vinculada.

Subscription é a fonte de verdade de entitlement. `active`/`trialing` mantêm plano pago. `past_due` recebe tolerância de 3 dias em `Billing Grace Until`. Depois da tolerância, ou em `canceled`, `unpaid`, `incomplete`, `incomplete_expired` e `paused`, o entitlement efetivo é Free.

`Cancel At Period End=true` não revoga imediatamente o acesso enquanto a subscription continuar `active`; o dashboard informa a data de `Current Period End`.

## Idempotência e concorrência
A tabela Airtable `StripeEvents` registra `Event ID`, tipo, status e horário. Fluxo:
1. verificar se já está `processed`;
2. adquirir lock por `event.id`;
3. marcar `processing`;
4. aplicar mutação;
5. marcar `processed` somente após sucesso;
6. em erro, marcar `error` e permitir retry posterior.

Quando Upstash está configurado, o lock é distribuído (`SET NX PX`) entre instâncias Vercel. Sem Upstash, o lock é apenas em memória por instância e Airtable continua sem unique constraint/transação; portanto, **Upstash é requisito do checklist antes de cobrança Live**.

## Customer Portal
`POST /api/billing-portal` cria sessão do Stripe Customer Portal somente depois de validar que o Customer pertence ao usuário da sessão. `return_url` é fixa para `/dashboard`; o browser não fornece URL arbitrária.

O Portal deve ser ativado no Stripe Dashboard em Test Mode. Se for permitir Starter ↔ Pro, configure a alteração de subscription no próprio Portal em vez de abrir um novo Checkout.

## Smoke seguro
Sem credenciais:
```bash
npm run stripe-smoke
```

Depois de configurar Test Mode:
```bash
npm run stripe-smoke -- --api
```

O modo `--api` aceita somente `sk_test_`, verifica os dois Prices (BRL, mensal, R$47/R$97) e o health do ambiente. Ele **não cria Customer, Checkout, subscription ou cobrança**.

## Sequência de validação Test Mode
1. Criar produtos/preços mensais no Stripe Test Mode.
2. Configurar `sk_test_`, `whsec_` e `price_...` na Vercel.
3. Manter `BILLING_LIVE_ENABLED=false`.
4. Configurar webhook `https://depoimentopro-app.vercel.app/api/billing-webhook`.
5. Rodar `npm run stripe-smoke -- --api`.
6. Executar Checkout com cartão de teste Stripe.
7. Confirmar que plano só muda após evento de subscription reconciliado.
8. Testar Portal, cancelamento no fim do período e atualização de forma de pagamento.
9. Testar `past_due`/grace e eventos repetidos/fora de ordem.
10. Concluir `docs/pre-live-billing-checklist.md` antes de qualquer preparação Live.
