# Alterações de schema do Airtable

## Testimonials
Campos aplicados no ambiente atual:
- `Moderado Em` — Date/Time. Registra a última ação de moderação.
- `Moderado Por` — Single line text. Guarda o record ID interno do usuário que moderou; não deve ser exibido publicamente.
- `Nota Interna` — Long text. Observação administrativa opcional.

Campos já existentes e usados pelo fluxo: `Consentimento Publicacao`, `Aprovado Em` e `Status`.

## Widgets
- `Public Token` — Single line text. Token opaco público do embed. O endpoint público não usa record IDs do Airtable como autorização.

## Users — billing
`Stripe Customer ID` já existia antes da etapa de billing.

Campos aplicados para billing readiness/hardening:
- `Stripe Subscription ID` — Single line text. ID `sub_...` da assinatura.
- `Subscription Status` — Single line text. Estado Stripe (`active`, `trialing`, `past_due`, etc.).
- `Current Period End` — Single line text com timestamp ISO 8601 UTC.
- `Billing Grace Until` — Single line text com timestamp ISO 8601 UTC para tolerância de `past_due`.
- `Cancel At Period End` — Checkbox. Indica cancelamento agendado ao fim do período atual; não revoga acesso enquanto a subscription continuar em estado que concede entitlement.

## StripeEvents
Tabela criada para idempotência/auditoria mínima de webhooks.
- `Event ID` — Single line text, campo primário.
- `Type` — Single line text.
- `Processed At` — Single line text ISO 8601 UTC.
- `Status` — Single line text (`processing`, `processed` ou `error`).
- `Error` — Long text, sem secrets.

O código usa o ID real da tabela `StripeEvents` em `lib/config.js` e nomes de campos para escrita/leitura. Nenhum secret é armazenado no Airtable.

Airtable não garante unicidade nem transações. Em Test/baixo volume existe lock por `event.id`; com Upstash configurado esse lock é distribuído entre instâncias. Para cobrança Live, Upstash é requisito operacional do checklist. Para escala paga maior, eventos/entitlements/contadores devem migrar gradualmente para armazenamento transacional.
