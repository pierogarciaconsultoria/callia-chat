
# AI Agent Hub — SaaS de atendimento WhatsApp multi-tenant

Hub externo reutilizável que múltiplos SaaS/clientes podem integrar de forma isolada. Cada tenant tem workspace próprio, chave de API, configuração de agente, base de produtos/FAQ, conexão WhatsApp e logs isolados.

## Avaliação do prompt original

O prompt é um bom briefing de arquitetura, mas é genérico demais para virar SaaS funcional sozinho. Faltava decidir provedor de WhatsApp, escopo de MVP, capacidades de IA e modelo de billing — agora definidos:

- WhatsApp: **Evolution API / Baileys** (não oficial)
- MVP: **Admin multi-tenant + API keys**, **Configuração de agente IA**, **Inbox + handoff humano**
- IA: **texto, áudio (STT+TTS) e visão**
- Billing: **provedor brasileiro (Asaas)** — entra em fase posterior

Aviso importante sobre Evolution/Baileys: não é oficial da Meta; existe risco real de banimento de número e instabilidade. Recomendo arquitetar a camada de WhatsApp como um **adapter** (interface comum) para no futuro plugar Meta Cloud API sem reescrever o resto.

## Escopo desta entrega (Fase 1 — MVP)

Fora do escopo agora: follow-ups automáticos, links de pagamento, billing Asaas, app mobile.

### 1. Multi-tenancy e contas

- Cadastro/login de **owners** (donos de workspace) via email/senha + Google.
- Cada workspace = um tenant isolado. Owner pode convidar **agentes** (atendentes humanos).
- Roles: `owner`, `admin`, `agent` (armazenadas em tabela separada `user_roles`, nunca no profile).
- Geração e rotação de **API keys por workspace** (mostradas só uma vez, hash no banco).
- Isolamento total de dados via RLS — nenhum tenant enxerga dados de outro.

### 2. Configuração do agente IA (por workspace)

Painel onde o cliente configura:
- **Persona/prompt do sistema** (tom, regras, restrições).
- **Base de conhecimento**: FAQ (texto), catálogo de produtos (CSV/upload manual com nome, descrição, preço, link), URL do site (placeholder para crawler futuro).
- **Idioma padrão** e **horário de atendimento**.
- **Regras de handoff**: palavras-chave que disparam transferência para humano (ex: "falar com atendente", "reclamação").
- **Voz**: ativar/desativar respostas em áudio, escolha de voz TTS.
- Placeholder para: links de pagamento, regras de follow-up, webhooks de CRM.

### 3. Conexão WhatsApp (Evolution API)

- Tela "Conectar WhatsApp": cria instância na Evolution API e mostra **QR Code** para parear.
- Status da instância: conectado / desconectado / aguardando QR.
- Webhook do Evolution recebido em edge function dedicada que roteia por instância → workspace.
- Adapter `WhatsAppProvider` com interface `sendText`, `sendAudio`, `sendImage`, `markRead` — implementação Evolution agora, pronto para Meta Cloud depois.

### 4. Pipeline de mensagens e IA

Fluxo quando chega mensagem do cliente:

```text
Evolution webhook
   → edge function (valida instância, identifica tenant)
   → grava mensagem em conversations/messages
   → se conversa em modo "humano": só notifica inbox, não responde
   → se modo "bot":
       → se áudio: STT (Lovable AI / Gemini)
       → se imagem: visão (Gemini)
       → monta contexto (persona + FAQ + catálogo + histórico)
       → chama Lovable AI Gateway (texto)
       → checa regras de handoff → se gatilho, marca conversa como "humano"
       → envia resposta via Evolution (texto e/ou TTS)
       → grava resposta + tokens consumidos
```

Toda IA passa pelo **Lovable AI Gateway** (chave gerenciada, sem custo de setup). Modelo padrão: `google/gemini-3-flash-preview`.

### 5. Inbox e handoff humano

- Lista de conversas por workspace, com filtros: bot / humano / não lidas.
- Visualização da thread em tempo real (Supabase Realtime).
- Botão **"Assumir conversa"** → para o bot, atendente responde manualmente pelo inbox; mensagens saem pela mesma instância Evolution.
- Botão **"Devolver ao bot"** retoma o atendimento automático.
- Indicador de qual atendente está atendendo (evita dois ao mesmo tempo).

### 6. API pública (para SaaS clientes integrarem)

Endpoints autenticados via **header `x-api-key`** (chave do workspace):
- `POST /api/messages` — envia mensagem proativa para um número.
- `POST /api/events` — cliente externo dispara evento (ex: "carrinho abandonado") que o agente pode usar.
- `GET /api/conversations` / `GET /api/conversations/:id/messages` — leitura.
- `POST /api/webhooks` — registrar URL de callback que o Hub chama em eventos (nova_mensagem, handoff, conversa_encerrada). Assinatura HMAC.
- Logs de auditoria por chamada (request, status, latência).

Sem rate limiting backend nesta fase (limitação atual da plataforma) — fica como item futuro.

### 7. Telas da aplicação

- `/login`, `/signup`, `/reset-password`
- `/onboarding` — criar workspace
- `/inbox` — conversas em tempo real
- `/agent` — configuração do agente (persona, FAQ, catálogo, voz, handoff)
- `/whatsapp` — conexão Evolution + QR
- `/api-keys` — gerar/rotacionar/revogar
- `/webhooks` — gerenciar callbacks
- `/team` — convidar usuários, gerenciar roles
- `/logs` — auditoria de chamadas e mensagens
- `/settings` — dados do workspace

Design: tema claro padrão shadcn, layout com sidebar fixa, foco em densidade de informação (tipo dashboard SaaS).

## Detalhes técnicos

- **Stack**: Vite + React + TS + Tailwind + shadcn (já existente no projeto).
- **Backend**: Lovable Cloud (Supabase) — Auth, Postgres com RLS, Realtime, Edge Functions, Storage (para áudios/imagens recebidas).
- **IA**: Lovable AI Gateway (`gemini-3-flash-preview` texto e visão; modelo de áudio para STT; TTS via gateway quando suportado, senão placeholder por trás de adapter).
- **WhatsApp**: precisa de URL e API key de uma instância Evolution API que o cliente final hospeda. Vou pedir essas credenciais como secrets quando chegar a hora de implementar a conexão.
- **Tabelas principais** (todas com RLS por `workspace_id`): `workspaces`, `workspace_members`, `user_roles`, `api_keys`, `agent_configs`, `products`, `faqs`, `whatsapp_instances`, `conversations`, `messages`, `handoff_events`, `webhooks`, `webhook_deliveries`, `audit_logs`.
- **Edge functions**: `whatsapp-webhook`, `process-message` (orquestra IA), `send-message`, `evolution-connect`, `public-api` (router das rotas `/api/*` autenticadas por api key), `webhook-dispatcher`.
- **Segurança**: roles em tabela separada com função `has_role` SECURITY DEFINER; api keys armazenadas como hash; validação de input com Zod em todas as edge functions; CORS configurado.

## Garantias sobre o código existente

Vou preservar tudo que já existe no projeto. As únicas alterações fora dos arquivos novos serão:
- `src/App.tsx` — adicionar rotas das novas páginas.
- `src/index.css` / `tailwind.config.ts` — apenas se precisar acrescentar tokens (sem remover existentes).

Qualquer outra mudança pedirei autorização antes.

## Fases seguintes (não incluídas agora)

- Follow-ups automáticos e régua de reengajamento
- Links de pagamento + integração Asaas (PIX/boleto/cartão) com webhook de confirmação
- Billing do próprio SaaS (planos por workspace, limites de mensagens)
- Crawler de site para RAG real (vector store)
- Adapter Meta Cloud API como alternativa ao Evolution
- Métricas/analytics por tenant

Posso começar pela Fase 1 quando você aprovar.
