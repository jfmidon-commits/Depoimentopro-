# Migração futura Airtable → Postgres/Supabase

Migrar quando concorrência, limites pagos, volume de chamadas ou relatórios exigirem transações e consultas mais eficientes; não apenas por atingir algumas centenas de registros.

Tabelas futuras: `users`, `campaigns`, `testimonials`, `widgets`, `subscriptions`, `audit_logs`.

Estratégia gradual: introduzir interface de repositório; criar schema com constraints/índices/RLS quando aplicável; migrar primeiro contadores/limites que precisam de atomicidade; exportar e reconciliar Airtable; trocar as rotas gradualmente.

Para consumo de limite, usar operação atômica/transação (`UPDATE ... WHERE used < limit RETURNING ...`) ou lógica equivalente dentro de transação.
