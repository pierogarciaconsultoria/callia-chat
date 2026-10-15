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
