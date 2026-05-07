# Fase 4 - Entrada de mensagens e webhook inbound

## Objetivo

Transformar o webhook da Evolution em uma entrada confiavel de eventos e mensagens, com idempotencia, normalizacao e persistencia no banco.

## Entregas da fase

- Persistencia de `MESSAGES_UPSERT`
- Ledger de idempotencia via `inbound_events`
- Upsert de `conversations`
- Persistencia de `messages`
- Atualizacao de `unread_count`
- Atualizacao de `last_message_at`
- Dedupe por `external_id`
- Normalizador do payload da Evolution

## Fluxo implementado

1. Evolution chama `whatsapp-webhook`
2. Sistema valida `instance_id` e `token`
3. Eventos de QR e conexao continuam atualizando a instancia
4. Evento `MESSAGES_UPSERT` e normalizado
5. `inbound_events` registra o evento com controle de duplicidade
6. `conversation` e criada ou atualizada
7. `message` e persistida com `direction`, `sender`, `type`, `content`, `media_url` e `external_id`
8. `inbound_events` recebe status final `processed` ou `failed`

## Resultado esperado

- Mensagens recebidas passam a existir no banco de forma consistente
- Duplicatas de webhook nao recriam conversa nem mensagem
- A base fica pronta para a fase 5 de IA e fase 6 de inbox

## Fechamento da fase

- Webhook `MESSAGES_UPSERT` normalizado e persistido
- `inbound_events` usado como ledger de processamento e idempotencia
- `conversations` atualizadas com `last_message_at`, `unread_count` e metadata basica
- `messages` persistidas com dedupe por `external_id`
- Indices adicionados para performance e deduplicacao
