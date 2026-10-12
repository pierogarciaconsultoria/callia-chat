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
