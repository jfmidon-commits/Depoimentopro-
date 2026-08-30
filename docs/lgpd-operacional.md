# LGPD operacional — DepoimentoPro

Este documento descreve o fluxo técnico mínimo; não substitui revisão jurídica.

## O que já existe
- consentimento explícito para publicação do depoimento;
- retirada de consentimento, com remoção do widget na próxima leitura;
- exclusão individual de depoimento pelo proprietário;
- páginas de Privacidade e Termos;
- logs técnicos sem conteúdo sensível desnecessário.

## Solicitação de exportação
Para uma solicitação do titular/usuário, exportar apenas registros pertencentes à conta: perfil, campanhas, depoimentos e widgets. Não incluir `Password Hash`, `AIRTABLE_TOKEN`, `SESSION_SECRET`, cookies ou credenciais Stripe.

O script `npm run backup` é administrativo e exporta a base inteira; não deve ser entregue diretamente a um usuário. Para direito de acesso, gerar recorte por owner.

## Exclusão da conta
Antes de excluir uma conta:
1. autenticar o solicitante;
2. identificar assinatura Stripe;
3. se houver assinatura, cancelar pelo backend/Stripe ou orientar cancelamento pelo Customer Portal conforme política comercial;
4. remover/despublicar widgets;
5. remover depoimentos e campanhas vinculados conforme política de retenção;
6. remover o usuário ou anonimizar o que tiver obrigação legítima de retenção;
7. registrar a conclusão sem manter secrets.

Não apagar registro financeiro que precise ser mantido por obrigação legal sem orientação jurídica/contábil.

## Assinatura e exclusão
Excluir dados do Airtable sem cancelar a assinatura Stripe pode gerar cobrança órfã. Portanto, a exclusão da conta deve verificar `Stripe Customer ID` / `Stripe Subscription ID` antes da remoção definitiva.

## Retirada de consentimento
Ao retirar `Consentimento Publicacao`, o depoimento não pode continuar no widget. O endpoint público usa `no-store` para evitar persistência de conteúdo revogado em cache.

## Retenção
Definir antes da cobrança pública:
- prazo para logs operacionais;
- prazo para eventos Stripe;
- retenção de backups;
- tratamento de dados após cancelamento da conta.

Backups devem ter acesso restrito e política de expiração.
