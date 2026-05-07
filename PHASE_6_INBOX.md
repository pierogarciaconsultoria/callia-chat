# Fase 6 - Inbox, realtime e atendimento humano

## Objetivo

Entregar a operacao humana do workspace com fila de conversas, thread em tempo real, filtro por instancia e transicao entre modo bot e modo humano.

## Entregas da fase

- Tela `/inbox` conectada ao banco real
- Hook `use-inbox` com carregamento, filtros e subscriptions realtime
- Lista de conversas por workspace com filtro por instancia e modo
- Thread da conversa com historico completo
- Acao de assumir conversa para atendimento humano
- Acao de devolver conversa ao bot
- Envio manual de mensagem pelo atendente via `send-message`
- Persistencia de mensagens humanas usando `sender = agent`

## Fluxo implementado

1. A inbox carrega conversas abertas do workspace ordenadas por `last_message_at`
2. O operador pode filtrar por instancia e por modo (`bot` ou `human`)
3. Ao abrir uma conversa, o sistema zera `unread_count`
4. Se a conversa estiver em modo `bot`, o operador pode assumir
5. Ao assumir, a conversa muda para `human` e registra o agente atual
6. O atendente envia resposta manual pela mesma trilha outbound da plataforma
7. Se quiser, o operador devolve a conversa para `bot`
8. Alteracoes de `conversations` e `messages` entram em tempo real via Supabase Realtime

## Ajustes de backend

- `send-message` agora valida membro do workspace autenticado
- `send-message` aceita `sender = agent` para envio humano
- `outbound.ts` persiste `agent_user_id` nas mensagens enviadas pelo atendente

## Resultado esperado

- O workspace ja consegue operar conversas reais sem sair do painel
- A transicao entre bot e humano fica funcional no mesmo fluxo operacional
- A base fica pronta para a Fase 7 de API publica e envio proativo externo
