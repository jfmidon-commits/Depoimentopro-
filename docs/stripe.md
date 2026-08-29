# Plano de pagamentos Stripe

Ainda não há cobrança real implementada. O frontend nunca deve alterar plano ou limite diretamente.

Planos: Free R$0, Starter R$47/mês, Pro R$97/mês.

Fluxo recomendado: backend cria Checkout Session `mode=subscription`; Stripe redireciona ao Checkout; webhook validado por assinatura processa `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.paid` e `invoice.payment_failed`; backend atualiza plano/limites; eventos são idempotentes por `event.id`; Customer Portal gerencia cancelamento e forma de pagamento.

Campos planejados: Stripe Customer ID, Stripe Subscription ID, Subscription Status, Current Period End e controle de eventos processados.

Nunca confiar em `plan` vindo do browser. Usar somente `STRIPE_PRICE_STARTER` e `STRIPE_PRICE_PRO` no servidor. Limites pagos devem migrar para contador transacional antes da cobrança pública.
