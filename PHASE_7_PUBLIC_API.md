# Fase 7 - API publica e chaves

## Objetivo

Abrir o hub para sistemas externos com autenticacao por `x-api-key`, envio proativo, recebimento de eventos customizados e leitura de conversas e mensagens.

## Entregas da fase

- Migracao com `api_keys`, `public_api_events` e `public_api_requests`
- Edge function `manage-api-keys` para listar, criar, rotacionar e revogar chaves
- Edge function `public-api` com autenticacao real por `x-api-key`
- `POST /messages` com fallback para instancia padrao
- `POST /events` com persistencia e deduplicacao por `externalId`
- `GET /conversations`
- `GET /conversations/:id/messages`
- Tela `/api-keys` conectada ao backend real
- Auditoria de requests por workspace

## Fluxo implementado

1. O admin gera uma chave na tela `/api-keys`
2. A chave bruta aparece uma unica vez e apenas o hash vai para o banco
3. O cliente externo chama a API publica com header `x-api-key`
4. A edge function valida prefixo, hash, status de revogacao e expiracao
5. `POST /messages` resolve a instancia explicitamente ou usa a padrao do workspace
6. O envio proativo reutiliza a mesma trilha outbound da plataforma
7. `POST /events` registra eventos externos e evita duplicidade por `externalId`
8. Leituras retornam conversas e mensagens do workspace autenticado
9. Toda chamada autenticada gera trilha de auditoria em `public_api_requests`

## Endpoints

- `POST /functions/v1/public-api/messages`
- `POST /functions/v1/public-api/events`
- `GET /functions/v1/public-api/conversations`
- `GET /functions/v1/public-api/conversations/:id/messages`
- `GET /functions/v1/public-api/knowledge/search`
- `GET /functions/v1/public-api/agent/context`
- `GET /functions/v1/public-api/connectors/hbook/availability`

## Resultado esperado

- O produto ja suporta integracoes externas reais com seguranca basica por chave
- O envio proativo por API fica operacional
- O workspace passa a ter governanca minima de credenciais e trilha de auditoria
- A base fica pronta para a Fase 8 de webhooks de saida, logs e auditoria expandida

## Ingestao de conversas externas (somente registro)

`POST /functions/v1/public-api/messages/ingest` — autenticado por `x-api-key`.

Espelha no inbox mensagens de canais que nao passam pela Evolution (ex.: API oficial da Meta com agente no n8n).
**Nunca envia nada pelo WhatsApp** e **nunca dispara** `process-message` ou `send-message`.

Body:

| Campo | Obrigatorio | Valores |
|---|---|---|
| `externalId` | sim | id da mensagem no canal (deduplicacao) |
| `channel` | nao | `whatsapp_cloud` (padrao) |
| `direction` | sim | `inbound` \| `outbound` |
| `sender` | sim | `customer` (so inbound) \| `ai` \| `human` (so outbound) |
| `contact.phone` | sim | E.164, ex.: `+5511999999999` |
| `contact.name` | nao | |
| `type` | nao | `text` (padrao) \| `image` \| `audio` \| `document` |
| `content` / `mediaUrl` | um dos dois | |
| `timestamp` | nao | ISO 8601 (padrao: agora) |
| `conversationExternalId` | nao | guardado em `metadata` |

Comportamento:

- Conversa: reutiliza a existente por workspace + telefone ou cria nova com `metadata.source = "external"`.
- Mensagem: gravada com `metadata.source = "external"`; `ai` vira `sender=bot`, `human` vira `sender=agent`.
- `last_message_at` atualizado; `unread_count` so incrementa para inbound de `customer`.
- Repetir o mesmo `externalId` retorna `200` com `duplicate: true` e nao grava nada novo.
- Toda chamada fica em `public_api_requests`.
- No inbox aparece o selo "via integracao"; a resposta manual fica bloqueada nessas conversas ate existir um adaptador do canal.

Respostas: `201` criado, `200` duplicado, `400 invalid_ingest_payload`, `401` chave ausente/invalida, `403` chave revogada/expirada.

```bash
curl -X POST "$BASE_URL/functions/v1/public-api/messages/ingest" \
  -H "x-api-key: ah_live_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "externalId": "wamid.HBgNNTUxMTk5OTk5OTk5ORUCABIYFjNFQjA",
    "channel": "whatsapp_cloud",
    "direction": "inbound",
    "sender": "customer",
    "contact": { "phone": "+5511999999999", "name": "Ana" },
    "type": "text",
    "content": "Oi, qual o horario de voces?",
    "timestamp": "2026-10-12T12:00:00Z"
  }'
# => 201 { "ok": true, "duplicate": false, "conversationId": "...", "messageId": "...", "sent": false }
```

Testes: `src/test/public-api-ingest.test.ts` (criacao, deduplicacao, outbound sem envio, chave invalida).

## Base de conhecimento (Fase 10)

Dois endpoints de leitura, mesma autenticacao `x-api-key` e mesmo escopo de workspace da chave. Nenhum deles aceita filtro de workspace no corpo — o `workspaceId` vem sempre da chave.

### `GET /functions/v1/public-api/knowledge/search`

Query params:

| Param | Obrigatorio | Valores |
|---|---|---|
| `q` | sim | texto da busca, nao vazio |
| `limit` | nao | 1..20, padrao 5 |

Comportamento:

- Gera o embedding de `q` com o provedor ja configurado (`EMBEDDING_MODEL`, padrao `text-embedding-3-small`); sem chave de IA ou em falha do provedor, a busca segue so por palavra-chave.
- Executa a funcao SQL `knowledge_search(workspace_id, query, query_embedding, limit)`: uniao de `tsvector` (`websearch_to_tsquery('portuguese', ...)` + `ts_rank_cd`) com similaridade por cosseno (`1 - (embedding <=> query_embedding)`), `max(score)` por trecho, ordenado por relevancia.
- So retorna trechos de fontes do workspace da chave; `is_active = false` fica fora do indice.
- Toda chamada fica em `public_api_requests`.

Resposta: `200 { "ok": true, "results": [{ "title", "content", "category", "score" }] }`.

```bash
curl "$BASE_URL/functions/v1/public-api/knowledge/search?q=politica%20de%20cancelamento&limit=5" \
  -H "x-api-key: ah_live_xxxxxxxx"
# => 200 { "ok": true, "results": [{ "title": "Politicas", "content": "...", "category": "politicas de cancelamento", "score": 0.82 }] }
```

### `GET /functions/v1/public-api/agent/context`

Sem params. Le `agent_configs` do workspace da chave.

Resposta: `200 { "ok": true, "persona_prompt", "language", "business_hours", "website_url", "payment_links", "handoff_keywords" }`; `404 agent_config_not_found` quando o workspace ainda nao salvou a tela "Agente IA".

```bash
curl "$BASE_URL/functions/v1/public-api/agent/context" -H "x-api-key: ah_live_xxxxxxxx"
```

Respostas dos dois: `400 invalid_search_query`, `401` chave ausente/invalida, `403` chave revogada/expirada, `404 agent_config_not_found`.

O preview da tela `/knowledge-base` ("Testar busca") passa pela edge function autenticada `knowledge-index` com `action: "search"`, que usa o mesmo `embedTexts` e a mesma `knowledge_search` — por isso o resultado visto no painel e identico ao da API, sem expor a `x-api-key` ao navegador.

Testes: `src/test/knowledge-chunking.test.ts` (divisao de trechos, sobreposicao, limpeza de HTML).

## Conector de reservas hbook (Fase 10)

### `GET /functions/v1/public-api/connectors/hbook/availability`

Mesma autenticacao `x-api-key`. O `companyId` **nunca** vem do chamador: ele e lido do conector `hbook` ativo do workspace da chave (`workspace_connectors.config ->> 'company_id'`).

Query params:

| Param | Obrigatorio | Valores |
|---|---|---|
| `checkin` | sim | `DD/MM/AAAA` |
| `checkout` | sim | `DD/MM/AAAA`, depois do check-in |
| `adults` | nao | 1..12, padrao 2 |
| `children` | nao | 0..12, padrao 0 |

### Fonte real dos dados (leia antes de mexer no parser)

O endereco `https://hbook.hsystem.com.br/Booking?companyId=...&checkin=...` e a pagina publica de reservas, mas **o HTML nao contem preco nem disponibilidade**: a pagina e um app Knockout que carrega tudo depois, via `POST /Booking/GetAvailability`. Fazer parse do HTML devolveria uma lista vazia para quaisquer datas — por isso o proxy chama o endpoint JSON que a propria pagina chama.

Corpo enviado (validado contra o motor em 2026-10-15):

```
{ "CompanyId", "ArrivalDateString": "DD/MM/AAAA", "DepartureDateString": "DD/MM/AAAA",
  "PromotionalCode": null, "AmountAdults", "AmountChildren", "ChildrenAges": [],
  "IsReturningAbandonedBooking": false, "IsReturningBudgetBooking": false,
  "Language": "pt", "AvailabilityToken": null }
```

- `AvailabilityToken` e dispensavel e nao se envia cookie de sessao: o motor responde sem nenhum dos dois.
- Resposta: `Rooms[] { RoomTypeName, Availability, NextAvailabilityDate, BestPrice { RateTypeId, TotalValue, FullTotalValue }, Rates[] { RateTypeId, RateTypeName, DailyPrice, TotalValue, FullTotalValue, PerDayRates[] } }` e `UnavailabilityMessages[]`.
- **A resposta nao traz moeda.** O campo `currency` do JSON do proxy vem de `workspace_connectors.config ->> 'currency'` (padrao `BRL`) e e o admin quem define na tela.
- O `Success` da resposta nao e confiavel (o motor devolve `Success: false` mesmo com acomodacoes disponiveis); o parser ignora o campo e decide por `Availability`.
- "Preco da quantidade 1": cada `Rates[]` ja e o preco de **uma** unidade da acomodacao; `Availability` e o numero de unidades. O total da estadia e `TotalValue`, entao nao ha multiplicacao por quantidade.
- Tarifa escolhida: a que o `BestPrice.RateTypeId` aponta; sem `BestPrice`, a de menor `TotalValue`. Assim o agente nunca cita tarifa que o hospede nao consegue reservar.

### Resposta

```json
{
  "available": true,
  "nights": 5,
  "rooms": [
    { "name": "CASAL + UMA PESSOA", "rate": "MELHOR TARIFA DISPONÍVEL", "total_price": 3900, "price_per_night": 780, "currency": "BRL", "units_available": 9 }
  ],
  "booking_link": "https://hbook.hsystem.com.br/Booking?companyId=5c38b782e74ff268604a8655&checkin=25%2F12%2F2026&checkout=30%2F12%2F2026&adults=2&children=0&language=pt"
}
```

`rooms` vem ordenado por `total_price` e so inclui acomodacao com `Availability > 0` e preco conhecido. `booking_link` ja vai preenchido e com `/` codificado como `%2F`. Sem nada disponivel, `available: false` e `rooms: []` (e nao `404`). Toda chamada fica em `public_api_requests`.

```bash
curl "$BASE_URL/functions/v1/public-api/connectors/hbook/availability?checkin=25/12/2026&checkout=30/12/2026&adults=2&children=0" \
  -H "x-api-key: ah_live_xxxxxxxx"
```

Erros: `400 invalid_stay_dates` (datas fora do formato, checkout <= check-in), `404 connector_not_available` (sem conector, conector inativo ou sem `company_id`), `401`/`403` de chave, `502 { "error": "upstream_unavailable" }` para qualquer falha do hbook.

Seguranca: o timeout do upstream e de 10 s (`AbortSignal.timeout`) e a resposta do hbook e sempre reconstruida a partir do corpo ja mapeado — **nenhum header, cookie ou status do hbook e repassado ao chamador**; ate o detalhe da falha vira um erro generico. Margem medida nas duas consultas reais de validacao: ~0,6 s de resposta do motor.

### Riscos de quebra pelo lado do hbook

- **Mudanca de layout da pagina nao quebra nada** (nao lemos HTML). O que quebra o parser e: renomear `Rooms`/`RoomTypeName`/`Availability`/`BestPrice`/`Rates`/`TotalValue`, exigir um `AvailabilityToken` real, ou passar a exigir cookie/sessao. Os testes de `src/test/hbook-connector.test.ts` usam o payload real capturado e falham na hora se algum desses campos mudar de nome.
- Se o motor passar a exigir token, o `400`/`401` do upstream chega como `502 upstream_unavailable`; nesse caso capture o `x-correlation-id` da resposta do hbook e compare com a trilha em `public_api_requests`.
- Limite de tamanho de header do runtime: as respostas do hbook trazem ~24 KB em `Content-Security-Policy` + `Content-Security-Policy-Report-Only`. Runtimes com teto baixo para o bloco de headers (o `fetch` do Node, por exemplo, estoura em 16 KB) falham nessa chamada mesmo com o motor no ar — se o endpoint retornar `upstream_unavailable` e um `curl` direto funcionar, verifique esse limite antes de culpar o parser.
- Regras de estadia do hospedador (ex.: minimo de noites) fazem `available: false` em datas que parecem boas; confirme no navegador com a mesma data antes de abrir bug.

Testes: `src/test/hbook-connector.test.ts` (noites, validacao de datas, corpo enviado ao motor, extracao do payload real, esgotado, escolha de tarifa).
