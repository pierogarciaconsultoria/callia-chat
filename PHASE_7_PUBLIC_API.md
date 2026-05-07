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
