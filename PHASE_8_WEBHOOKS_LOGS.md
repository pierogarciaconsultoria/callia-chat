# Fase 8 - Webhooks de saida, logs e auditoria

## Objetivo

Entregar callbacks externos assinados, retries controlados, rastreio de entregas e um painel de logs operacionais e administrativos.

## Entregas da fase

- Migracao com enriquecimento de `webhooks` e `webhook_deliveries`
- Assinatura HMAC `sha256` para payloads externos
- Edge function `webhook-dispatcher` para fila e processamento de entregas
- Edge function `manage-webhooks` para listar, criar, editar, remover e rotacionar segredo
- Eventos de saida conectados ao runtime real:
  - `message.received`
  - `message.sent`
  - `conversation.handoff`
  - `public_api.event.received`
- Retries com reprocessamento de pendencias
- Tela `/webhooks` conectada ao backend real
- Tela `/logs` com webhooks, API publica, outbound e auditoria
- Escrita de `audit_logs` em operacoes administrativas

## Fluxo implementado

1. O admin cadastra um webhook no painel
2. O sistema gera ou mantém um segredo por webhook
3. Quando um evento operacional ocorre, o runtime chama o `webhook-dispatcher`
4. O dispatcher cria registros em `webhook_deliveries`
5. Cada entrega assina o corpo com `x-callia-signature`
6. Falhas de rede ou HTTP nao-2xx entram em retry ate o limite configurado
7. O painel mostra payload, headers, tentativas, resposta e erro
8. A area de logs consolida webhooks, requests da API pública, outbound e trilha administrativa

## Headers de assinatura

- `x-callia-event`
- `x-callia-delivery-id`
- `x-callia-correlation-id`
- `x-callia-attempt`
- `x-callia-timestamp`
- `x-callia-signature`

Assinatura:

- Formato: `sha256=<hex>`
- Base assinada: `{timestamp}.{payload-json}`

## Resultado esperado

- O produto passa a notificar sistemas externos de forma verificavel
- A equipe consegue diagnosticar falhas de integracao pelo painel
- O projeto fica pronto para a fase final de acabamento, hardening e go-live
