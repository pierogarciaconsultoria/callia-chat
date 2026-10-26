# Callia Chat

Atendimento via WhatsApp com agente de IA, inbox humana, API pública e webhooks de saída, oferecido como SaaS multi-tenant:
cada cliente (workspace) tem dados, chaves, base de conhecimento e logs isolados por RLS, e a plataforma é administrada por um console central.

## Camada SaaS

| Peça | Como funciona |
|---|---|
| Console central (`/admin`) | Só para `user_roles.role = 'platform_admin'`. Visão geral, clientes, planos, usuários, auditoria e configurações. Backend: function `platform-admin`. |
| Clientes | Criados pela plataforma (dono existente ou convidado por e-mail). Autoatendimento desligado por padrão (`platform_settings`). |
| Planos | Limites de instâncias, membros, mensagens automáticas/mês e fontes; IA, agente externo e conectores por plano. Override por cliente em `workspaces.limit_overrides`. |
| Ciclo de vida | `trial` → `active` → `suspended`/`canceled`. Trial vencido ou suspenso: mensagens recebidas são guardadas, mas bot, envios, API e criação de recursos param. |
| Cota mensal | Conta envios do bot e da API (não da equipe). Esgotada: API responde 429 e conversas novas vão para a equipe. |
| Suporte | O admin da plataforma entra num cliente de forma explícita (`is_support`) e tudo fica em `audit_logs` (`platform.*`). |
| Aplicação dos limites | No backend (`_shared/entitlements.ts` + `get_workspace_entitlements`), não só na tela. |

## Assistente de configuração (`/agent/setup`)

A persona e as instruções do agente são montadas a partir do que a empresa já publicou:
site (rastreado no próprio domínio, respeitando robots.txt), Instagram (dados públicos ou texto colado), documentos e texto livre.
A IA (`AI_SETUP_MODEL`, padrão em produção `gpt-4.1`) gera um rascunho com persona, regras, horário, transferência,
perguntas frequentes, catálogo e **o que faltou nas fontes**; o admin revisa e aplica por seção. As fontes também
entram na base de conhecimento usada nas respostas. Backend: function `agent-setup`.

## Integrações (`/integrations`)

Cartões de autoatendimento para o cliente do SaaS, com o mínimo de campos:
- **WhatsApp**: QR Code ou código de 8 dígitos (sem QR, pelo celular); o Callia cria a instância e o webhook.
- **Hospedin (PMS)**: só e-mail e senha de um usuário do Hospedin; o Callia descobre a conta, importa as categorias,
  detecta reais/centavos e mostra um teste de valores. Credenciais cifradas em `workspace_connectors.secret_ciphertext`.
- **Link de reservas**: URL do motor (hbook ou outro), enviado ao hóspede já com datas e hóspedes.

A ferramenta de disponibilidade do agente usa o provedor conectado (Hospedin → hbook) via `_shared/availability.ts`;
novos PMS entram como mais um provedor sem mudar o agente. Backend: function `integrations`.

## Fotos (Base de conhecimento → Fotos)

Álbuns por acomodação/área no bucket público `media`. Fontes: pasta do Google Drive compartilhada por link
(subpastas = álbuns; fotos baixadas em até 1600 px, HEIC convertido), fotos das categorias do Hospedin e upload no painel.
O agente recebe a ferramenta `enviar_fotos` (até 5 por pedido) quando há fotos. Backend: function `media`.

## Como o agente responde

```text
WhatsApp ─► Evolution API ─► whatsapp-webhook ─► record_message (conversa + mensagem + não lidas, idempotente)
                                   │
                                   └─► process-message (em segundo plano)
                                         1. só age em conversa "bot" e uma vez por mensagem (agent_runs)
                                         2. debounce: rajada de mensagens → uma resposta
                                         3. áudio → transcrição · imagem → descrição
                                         4. palavra-chave de handoff → humano
                                         5. agente externo (n8n…) se ativo; falhou → segue interno
                                         6. IA interna: persona + guardrails + RAG + ferramentas
                                            (transferir_para_atendente, buscar_conhecimento, consultar_disponibilidade)
                                         7. sem IA configurada → melhor FAQ ou handoff
                                   └─► sendOutbound ─► Evolution ─► cliente  (+ webhook message.sent)
```

A equipe assume pela inbox (ou respondendo pelo celular, o que também pausa o bot) e devolve ao bot quando quiser.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `src/` | Painel React (inbox, agente, base de conhecimento, WhatsApp, API keys, webhooks, logs, equipe, configurações) |
| `supabase/migrations/` | Schema, RLS, privilégios por coluna, RPCs e busca híbrida |
| `supabase/functions/_shared/` | Runtime comum: erros, Evolution, IA, pipeline do agente, canal, webhooks, hbook, conhecimento |
| `supabase/functions/*/` | 15 edge functions (contratos em [docs/EDGE_CONTRACTS.md](docs/EDGE_CONTRACTS.md)) |
| `supabase/tests/*.sql` | Testes de isolamento, permissões, planos, limites e status do tenant |
| `scripts/e2e/` | Teste ponta a ponta descartável com functions reais |

## Desenvolvimento

```bash
npm install
cp .env.example .env          # VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                   # painel em http://localhost:8080
```

## Testes

| Comando | O que valida | Requer |
|---|---|---|
| `npm test` | Testes unitários (pipeline, Evolution, hbook, chunking, webhooks, cripto, UI) | Node |
| `npm run typecheck:functions` | Tipos das edge functions | Deno |
| `npm run test:sql` | Migrations + RLS + camada SaaS em Postgres descartável | Docker |
| `DENO=$(which deno) npm run test:e2e` | Ponta a ponta com functions reais e GoTrue: webhook → IA → envio, debounce, eco, handoff, API pública, webhooks assinados, console da plataforma, limites, suspensão e cota | Docker + Deno |

O e2e sobe Postgres, PostgREST e o edge-runtime com as functions reais, mais um container com Evolution e OpenAI falsas. Tudo é removido no fim.

## Deploy

Ver [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md) e [PILOT_GO_LIVE_CHECKLIST.md](PILOT_GO_LIVE_CHECKLIST.md).
