# Stripe — billing readiness

O código de billing está preparado, mas cobrança real permanece bloqueada até configuração explícita.

## Planos
- Free — R$ 0 — 5 depoimentos.
- Starter — R$ 47/mês — 50 depoimentos **provisórios; confirmar comercialmente antes de cobrança pública**.
- Pro — R$ 97/mês — ilimitado no produto.

Os limites vivem em `lib/plans.js`. O frontend não define preço nem entitlement.

## Arquitetura
Para respeitar o limite de Functions do Vercel Hobby, existe uma única Function `api/billing.js`. O `vercel.json` mantém URLs semânticas por rewrite:
- `POST /api/billing-checkout` → checkout;
- `POST /api/billing-portal` → Customer Portal;
- `POST /api/billing-webhook` → webhook Stripe.

Checkout e Portal exigem sessão, same-origin/CSRF e rate limit. O webhook não usa sessão nem CSRF; ele exige corpo bruto e assinatura `Stripe-Signature` válida.

## Variáveis
```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
APP_URL=https://depoimentopro-app.vercel.app
BILLING_LIVE_ENABLED=false
```

Uma `sk_live_` continua bloqueada enquanto `BILLING_LIVE_ENABLED` não for exatamente `true`. Isso evita ativação acidental de cobrança real.

## Checkout
O browser envia somente `plan: starter|pro`. Qualquer `priceId` enviado pelo cliente é rejeitado. O servidor mapeia o plano para `STRIPE_PRICE_STARTER`/`STRIPE_PRICE_PRO`, cria ou reutiliza Customer e cria Checkout Session `mode=subscription`.

O campo `Plano` **não muda no checkout**. A mudança só ocorre depois de webhook assinado.

## Webhooks suportados
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

A fonte de verdade de entitlement é o estado da assinatura + price ID conhecido pelo backend. `active`/`trialing` mantêm plano pago. `past_due` recebe tolerância de 3 dias em `Billing Grace Until`. Depois da tolerância, ou em `canceled`, `unpaid` e estados inválidos, o entitlement efetivo é Free.

## Idempotência
A tabela Airtable `StripeEvents` registra `Event ID`, tipo, status e horário. Eventos com status `processed` são ignorados em replay. Há cache em memória adicional, mas a tabela é a camada persistente.

Airtable ainda não garante unicidade/transações. Para escala paga maior, a idempotência e os contadores devem migrar para armazenamento transacional.

## Customer Portal
`POST /api/billing-portal` cria uma sessão do Stripe Customer Portal. O Portal deve ser ativado no Dashboard Stripe em Test Mode antes do primeiro teste manual.

## Sequência de teste
1. Criar produtos/preços mensais no Stripe Test Mode.
2. Configurar `sk_test_`, `whsec_` e `price_...` na Vercel.
3. Manter `BILLING_LIVE_ENABLED=false`.
4. Configurar webhook `https://depoimentopro-app.vercel.app/api/billing-webhook`.
5. Executar checkout com cartão de teste Stripe.
6. Confirmar que o plano só muda após webhook.
7. Testar cancelamento/portal e `past_due` em ambiente de teste.
8. Só depois preparar chaves live.
