# Alterações de schema do Airtable

## Testimonials
Campos aplicados no ambiente atual:
- `Moderado Em` — Date/Time. Registra a última ação de moderação.
- `Moderado Por` — Single line text. Guarda o record ID interno do usuário que moderou; não deve ser exibido publicamente.
- `Nota Interna` — Long text. Observação administrativa opcional.

Campos já existentes e usados pelo fluxo: `Consentimento Publicacao`, `Aprovado Em` e `Status`.

## Widgets
- `Public Token` — Single line text. Token opaco público do embed. O endpoint público não usa record IDs do Airtable como autorização.

Não dependa de field IDs fixos para esses campos novos. O código usa os nomes dos campos.
