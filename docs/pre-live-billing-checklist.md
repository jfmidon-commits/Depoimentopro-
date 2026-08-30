# Checklist obrigatório antes de Stripe Live

Este checklist é um **gate manual**. Não habilite cobrança real enquanto qualquer item obrigatório estiver pendente.

## Código e deploy
- [ ] `main` sem alterações locais pendentes e CI 100% verde.
- [ ] Vercel Production verde.
- [ ] Quantidade de Functions continua dentro do limite do plano Vercel atual.
- [ ] Production E2E Free verde após a última mudança de billing.
- [ ] Nenhum `.env`, secret, token, `sk_*`, `whsec_*` ou credencial real entrou no Git.

## Stripe Test Mode
- [ ] `STRIPE_SECRET_KEY` usa `sk_test_...` durante toda a validação.
- [ ] Starter é R$ 47/mês em BRL e o Price ID foi validado.
- [ ] Pro é R$ 97/mês em BRL e o Price ID foi validado.
- [ ] `npm run stripe-smoke -- --api` passou.
- [ ] Checkout Free → Starter passou com cartão de teste.
- [ ] Checkout Free → Pro passou com cartão de teste.
- [ ] Plano só mudou depois de webhook de subscription confirmado.
- [ ] Customer existente foi reutilizado somente quando pertence ao mesmo usuário.
- [ ] Tentativa de segundo checkout com subscription ativa foi bloqueada.
- [ ] Mudança de plano de assinatura existente foi feita pelo Customer Portal/configuração Stripe, sem criar assinatura paralela.

## Webhook
- [ ] Endpoint Test: `https://depoimentopro-app.vercel.app/api/billing-webhook`.
- [ ] Assinatura `Stripe-Signature` inválida retorna erro e não altera dados.
- [ ] Corpo bruto é validado antes de `JSON.parse`.
- [ ] Eventos Test/Live incompatíveis com a chave atual são rejeitados.
- [ ] `checkout.session.completed` faz apenas linkage seguro; não concede entitlement.
- [ ] `customer.subscription.created` validado.
- [ ] `customer.subscription.updated` validado.
- [ ] `customer.subscription.deleted` validado.
- [ ] `invoice.paid` validado.
- [ ] `invoice.payment_failed` validado.
- [ ] Replay do mesmo `event.id` é idempotente.
- [ ] Evento fora de ordem não regride uma subscription nova para uma antiga.
- [ ] `subscription.deleted` antigo de outra subscription não derruba a subscription atual.
- [ ] Upstash Redis ativo em produção para lock distribuído + rate limiting antes do primeiro cliente pago.

## Estados da assinatura
- [ ] `active` concede plano pago correto.
- [ ] `trialing` concede plano pago correto.
- [ ] `past_due` mantém apenas 3 dias de tolerância.
- [ ] Após grace, entitlement efetivo cai para Free.
- [ ] `incomplete` não concede plano pago.
- [ ] `incomplete_expired` não concede plano pago.
- [ ] `unpaid` não concede plano pago.
- [ ] `paused` não concede plano pago.
- [ ] `cancel_at_period_end=true` mantém o acesso até o fim do período enquanto status continuar ativo.
- [ ] Após cancelamento efetivo, usuário volta a Free.

## Customer Portal
- [ ] Portal ativado no Stripe Dashboard em Test Mode.
- [ ] Return URL fixa para `/dashboard`.
- [ ] Portal de um Customer não pode ser aberto por outro usuário.
- [ ] Atualização da forma de pagamento testada.
- [ ] Cancelamento no fim do período testado.
- [ ] Alteração Starter ↔ Pro configurada/testada no Portal, se essa opção comercial estiver habilitada.

## Airtable, backup e LGPD
- [ ] Campos Stripe do Users revisados.
- [ ] `StripeEvents` recebendo eventos e estados `processing`, `processed` e `error` corretamente.
- [ ] Backup administrativo executado e arquivo armazenado em local privado.
- [ ] Procedimento `docs/restore-airtable.md` revisado.
- [ ] Fluxo de retirada de consentimento validado.
- [ ] Fluxo de exclusão de depoimento validado.
- [ ] Procedimento de exclusão de conta paga inclui cancelamento da subscription para impedir novas cobranças.
- [ ] Política de retenção/LGPD revisada.

## Proteções de produção
- [ ] Upstash configurado e `/api/health` mostra `rateLimit: "redis"`.
- [ ] Turnstile configurado e testado no formulário público.
- [ ] Logs não contêm PII/secrets.
- [ ] Monitoramento/alerta mínimo de erros de billing definido.
- [ ] Termos comerciais e política de privacidade revisados.
- [ ] Limite comercial do Starter (atualmente 50) confirmado definitivamente.

## Gate Live
- [ ] Criar produtos/prices **Live** separadamente e conferir valores manualmente.
- [ ] Criar webhook **Live** separado e conferir eventos.
- [ ] Inserir `sk_live_`, `whsec_` e Price IDs live somente na Vercel Production.
- [ ] Fazer um último health/smoke sem habilitar cobrança live.
- [ ] `BILLING_LIVE_ENABLED` permanece `false` até aprovação manual final.
- [ ] Aprovação manual registrada.
- [ ] Somente então alterar `BILLING_LIVE_ENABLED=true`.

Se qualquer teste pós-ativação falhar: defina `BILLING_LIVE_ENABLED=false` imediatamente e investigue antes de aceitar nova assinatura.
