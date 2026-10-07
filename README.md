# Callia Chat

Hub SaaS multi-tenant para atendimento no WhatsApp com agente de IA, inbox humano, API pública, webhooks de saída e trilha operacional para piloto real.

## Status atual

- Fases `0` a `9` implementadas no repositório
- Frontend em `React + Vite + TypeScript`
- Backend operacional em `Supabase + Edge Functions`
- Integração principal de canal via `Evolution API`
- Estrutura pronta para piloto controlado

## Principais capacidades do MVP

- Multi-tenant por `workspace`
- Branding por workspace com `custom_domain` preparado
- Múltiplas instâncias de WhatsApp por workspace
- Webhook inbound com idempotência
- Pipeline de IA com FAQ, produtos, guardrails, áudio, imagem e handoff
- Inbox humano com realtime e assumir/devolver conversa
- API pública autenticada por `x-api-key`
- Webhooks de saída com assinatura HMAC e retries
- Logs operacionais e auditoria administrativa

## Stack

- `React 18`
- `Vite 5`
- `TypeScript`
- `Tailwind CSS`
- `Supabase Auth / Postgres / Realtime / Edge Functions`
- `Vitest`

## Estrutura principal

- `src/pages`: telas do painel
- `src/hooks`: hooks operacionais do frontend
- `src/lib`: helpers e contratos do app
- `supabase/migrations`: evolução do schema
- `supabase/functions`: edge functions operacionais
- `src/data/project-board.ts`: board público de fases

## Rotas principais

- `/inbox`: operação humana
- `/agent`: configuração do agente
- `/whatsapp`: instâncias e conexão
- `/api-keys`: gestão da API pública
- `/webhooks`: gestão de callbacks externos
- `/logs`: auditoria e rastreio
- `/settings`: branding e configuração do workspace
- `/acompanhamento`: acompanhamento público temporário do projeto

## Setup local

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis do frontend

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

Variáveis mínimas:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

### 3. Rodar o painel

```bash
npm run dev
```

### 4. Rodar testes

```bash
npm run test
```

### 5. Gerar build local

```bash
npm run build
```

## Secrets esperados nas Edge Functions

Necessários conforme o ambiente e as features habilitadas:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EVOLUTION_BASE_URL`
- `EVOLUTION_API_KEY`
- `AI_COMPAT_API_KEY`
- `AI_COMPAT_BASE_URL`
- `OPENAI_API_KEY`
- `AI_DEFAULT_MODEL`
- `STT_MODEL`
- `VISION_MODEL`

## Fluxo operacional resumido

1. Workspace é criado e ganha branding/configuração base
2. Admin conecta uma ou mais instâncias de WhatsApp
3. Webhook inbound persiste eventos, conversas e mensagens
4. `process-message` decide entre resposta automática e handoff
5. `generate-agent-prompt` cria prompts de sistema a partir do segmento e contexto da empresa
6. Inbox humana assume ou devolve conversas ao bot
7. API pública e webhooks de saída conectam sistemas externos
8. Logs consolidam auditoria, outbound, requests e entregas

## Agente externo (n8n)

Ative **Usar agente externo (via webhook)** em `/agent` para delegar a resposta automática do workspace a um fluxo externo, como o n8n. Com essa opção ativa:

1. A Evolution entrega `MESSAGES_UPSERT` ao `whatsapp-webhook`.
2. O Callia grava a conversa e a mensagem, mas não chama `process-message`.
3. O Callia envia o evento `message.received` aos webhooks ativos do workspace.
4. O n8n valida a assinatura, consulta ou processa o contexto e responde por `POST /functions/v1/public-api/messages`.
5. A resposta é gravada como `sender = bot` e `metadata.source = external_agent`, enviada pela Evolution e reconciliada com o eco `fromMe` sem abrir atendimento humano.

Uma resposta feita diretamente pelo celular é diferente: ela é gravada como `sender = agent`, coloca a conversa em modo `human` e pausa o bot pelo período configurado em **Pausa após resposta humana**. Assumir a conversa pela Inbox aplica a mesma pausa.

### Evento `message.received`

Exemplo de payload:

```json
{
  "workspaceId": "workspace-uuid",
  "conversationId": "conversation-uuid",
  "whatsappInstanceId": "instance-uuid",
  "instanceId": "instance-uuid",
  "conversationMode": "bot",
  "messageId": "message-uuid",
  "customerPhone": "5511999999999",
  "customerName": "Maria",
  "type": "text",
  "content": "Quero conhecer os planos",
  "mediaUrl": null,
  "transcription": null,
  "externalId": "evolution-message-id",
  "direction": "inbound",
  "receivedAt": "2026-10-07T12:00:00.000Z"
}
```

Cada entrega inclui os headers `x-callia-event`, `x-callia-delivery-id`, `x-callia-correlation-id`, `x-callia-timestamp` e `x-callia-signature`. A assinatura usa HMAC SHA-256 no formato `sha256=<hex>`, calculada sobre:

```text
{x-callia-timestamp}.{payload-json}
```

O n8n deve recalcular a assinatura com o segredo do webhook e usar comparação segura antes de processar o evento. Também deve ignorar `message.received` quando `conversationMode` for `human`.

### Responder com texto

O endpoint aceita `phone` ou `conversationId`. O uso de `conversationId` mantém a instância associada à conversa.

```bash
curl -X POST "$SUPABASE_URL/functions/v1/public-api/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CALLIA_API_KEY" \
  -d '{
    "conversationId": "conversation-uuid",
    "text": "Olá! Posso ajudar com nossos planos.",
    "idempotencyKey": "n8n-run-123-text"
  }'
```

Também é possível iniciar ou localizar a conversa pelo telefone:

```json
{
  "phone": "5511999999999",
  "text": "Olá! Como posso ajudar?"
}
```

### Responder com imagem e legenda

Quando `mediaUrl` é informado, o Callia usa `sendEvolutionMedia`; `caption` é enviada como legenda da mídia.

```bash
curl -X POST "$SUPABASE_URL/functions/v1/public-api/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CALLIA_API_KEY" \
  -d '{
    "conversationId": "conversation-uuid",
    "mediaUrl": "https://cdn.exemplo.com/catalogo.jpg",
    "mimeType": "image/jpeg",
    "caption": "Confira nosso catálogo atualizado.",
    "idempotencyKey": "n8n-run-123-image"
  }'
```

## Deploy operacional

Fluxo recomendado:

1. Aplicar migrations do Supabase
2. Publicar edge functions
3. Configurar secrets de ambiente
4. Validar instância padrão do WhatsApp
5. Gerar primeira API key
6. Configurar pelo menos um webhook de teste
7. Executar checklist de piloto

Consulte:

- `PILOT_GO_LIVE_CHECKLIST.md`
- `DEPLOY_RUNBOOK.md`
- `RLS_TEST_PLAN.md`

## Documentos das fases

- `PHASE_0_FOUNDATION.md`
- `PHASE_1_BACKEND_ADAPTERS.md`
- `PHASE_5_PIPELINE.md`
- `PHASE_6_INBOX.md`
- `PHASE_7_PUBLIC_API.md`
- `PHASE_8_WEBHOOKS_LOGS.md`
- `PHASE_9_GO_LIVE.md`

## Observações finais

- O repositório está pronto para piloto, mas a ativação real ainda depende de aplicar migrations e publicar as edge functions no projeto Supabase alvo.
- Os secrets de provedores permanecem no backend; o frontend não deve receber credenciais sensíveis.
