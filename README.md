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
- `src/data/project-board.ts`: board público de fases (gerado a partir do `PROJECT_BOARD.md`)

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
5. Inbox humana assume ou devolve conversas ao bot
6. API pública e webhooks de saída conectam sistemas externos
7. Logs consolidam auditoria, outbound, requests e entregas

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
