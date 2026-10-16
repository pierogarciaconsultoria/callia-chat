# Deploy Runbook

## Objetivo

Guiar a publicação do MVP em ambiente Supabase para piloto controlado.

## Pré-requisitos

- Projeto Supabase criado
- Secrets do canal WhatsApp disponíveis
- Credenciais do provedor de IA disponíveis
- DNS e domínio do frontend definidos, se aplicável

## Ordem recomendada

### 1. Frontend

- Configurar `.env` com:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
- Executar:

```bash
npm install
npm run test
npm run build
```

### 2. Banco

- Aplicar todas as migrations em ordem cronológica
- Confirmar existência de tabelas:
  - `workspace_branding`
  - `inbound_events`
  - `outbound_messages`
  - `api_keys`
  - `public_api_requests`
  - `webhooks`
  - `webhook_deliveries`
  - `audit_logs`
  - `knowledge_sources`
  - `knowledge_chunks`
  - `workspace_connectors`

### 3. Edge Functions

Publicar:

- `evolution-connect`
- `whatsapp-webhook`
- `process-message`
- `send-message`
- `manage-api-keys`
- `public-api`
- `manage-webhooks`
- `webhook-dispatcher`
- `knowledge-index`

Sempre que `supabase/functions/_shared/*.ts` mudar, redeploye as functions que importam aquele modulo (`public-api` e `knowledge-index`) — o `_shared` nao e publicado separado; ele entra no bundle de cada function no momento do deploy.

### 4. Secrets do Supabase

Configurar:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EVOLUTION_BASE_URL`
- `EVOLUTION_API_KEY`
- `AI_COMPAT_API_KEY` ou `OPENAI_API_KEY`
- `AI_COMPAT_BASE_URL`
- `AI_DEFAULT_MODEL`
- `STT_MODEL`
- `VISION_MODEL`
- `EMBEDDING_MODEL` (opcional; sem ele a busca usa apenas tsvector)

### 5. Painel administrativo

- Criar workspace piloto
- Confirmar branding
- Cadastrar e conectar instância de WhatsApp
- Definir instância padrão
- Validar webhook inbound
- Configurar prompt e comportamento do agente
- Cadastrar base de conhecimento (FAQ, textos, arquivos, URLs) e rodar a indexacao
- Cadastrar o conector hbook (id da empresa e moeda) na aba "Conector de reservas" de `/knowledge-base`
- Criar primeira API key
- Configurar webhook de saída de teste

## Validações mínimas pós-deploy

- Login e onboarding funcionam
- Inbox abre sem erro
- Mensagem inbound entra em `conversations` e `messages`
- Resposta outbound chega no WhatsApp
- Handoff move a conversa para modo humano
- `POST public-api/messages` envia mensagem proativa
- Webhook externo recebe evento assinado
- Logs mostram request, outbound e delivery
- `GET public-api/knowledge/search` retorna trechos do workspace da chave
- `GET public-api/connectors/hbook/availability` retorna `rooms` com preco e `booking_link` para datas com estadia possivel

## Critérios para liberar piloto

- Sem erros bloqueantes de autenticação
- Sem erros de RLS nos fluxos normais
- Instância principal está estável
- API key e webhook de teste funcionam
- Equipe sabe operar inbox, logs e webhooks
