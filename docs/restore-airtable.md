# Restore seguro do Airtable

O script `npm run backup` gera um export administrativo das tabelas principais sem `Password Hash`. Esse backup é voltado a auditoria, recuperação de conteúdo e apoio a incidentes — **não** é um restore automático completo de autenticação.

## Princípios
1. Nunca restaurar diretamente em produção sem revisar o arquivo.
2. Nunca sobrescrever em massa registros existentes por nome/e-mail sem comparação manual.
3. Nunca recriar `Password Hash` a partir do backup normal, porque ele é deliberadamente removido.
4. Preservar record IDs/relacionamentos quando possível; recriar registros altera IDs e exige remapear links.
5. Fazer um novo backup imediatamente antes de qualquer operação de recuperação.

## Cenário A — campo alterado por engano em poucos registros
Preferir correção manual no Airtable ou atualização por IDs conhecidos. Compare o registro atual com o JSON de backup e restaure somente os campos afetados.

## Cenário B — depoimento/campanha/widget excluído por engano
O JSON pode recuperar o conteúdo, mas a recriação gera novo record ID. Depois de recriar, valide manualmente os links `User`, `Campaign`, `Testimonials` e contadores relacionados. Não publique automaticamente depoimento sem revalidar `Consentimento Publicacao`.

## Cenário C — usuário excluído
O backup normal não contém `Password Hash`. Recriar o perfil não restaura a capacidade de login original. O procedimento seguro é recriar os dados não sensíveis e exigir um fluxo de redefinição/novo cadastro quando existir suporte apropriado. Não invente senha e não copie hashes de fontes não autorizadas.

## Cenário D — incidente amplo
1. Desabilite writes não essenciais e billing, se necessário.
2. Gere snapshot atual para preservar evidências.
3. Compare o snapshot com o último backup confiável.
4. Restaure primeiro Users, depois Campaigns, Testimonials e Widgets, mantendo uma tabela de mapeamento `oldRecordId → newRecordId` quando recriação for inevitável.
5. Refaça links entre registros com base nesse mapa.
6. Recalcule `Depoimentos Usados`, `Total Respostas` e outros contadores derivados.
7. Valide ownership/multi-tenant antes de reabrir o sistema.
8. Valide widgets: apenas aprovados + consentidos podem aparecer.
9. Rode suíte de testes e E2E antes de reabrir writes/billing.

## Stripe / billing
A tabela `StripeEvents` é trilha operacional, mas a Stripe continua sendo a fonte externa da assinatura. Em incidente de billing:
- não restaure manualmente uma assinatura para `active` apenas porque um backup antigo dizia `active`;
- consulte/reconcilie a subscription atual da Stripe;
- só então atualize `Stripe Subscription ID`, `Subscription Status`, `Current Period End`, `Billing Grace Until`, `Cancel At Period End`, `Plano` e limite;
- mantenha `BILLING_LIVE_ENABLED=false` durante recuperação de produção paga se houver dúvida.

## Validação obrigatória pós-restore
- autenticação de usuários afetados;
- ownership de campanhas/depoimentos/widgets;
- contadores;
- consentimento de publicação;
- estado efetivo de plano;
- health check;
- CI/testes locais;
- smoke E2E.

Não há script destrutivo automático de restore por design. Um restore em Airtable sem transações e sem constraints fortes deve permanecer uma operação assistida e auditada.
