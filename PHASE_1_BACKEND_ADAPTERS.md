# Fase 1 - Estrutura do backend e adapters

## Objetivo

Criar a ossatura do runtime para que as proximas fases reutilizem interfaces, validacoes, padroes de erro, observabilidade e autenticacao externa sem espalhar regra de negocio.

## O que esta fase cobre

- Interfaces dos adapters de WhatsApp, IA, audio, visao e dispatcher de webhook
- Validacao de contratos com `Zod`
- Convencoes de autenticacao por `x-api-key`
- Padrao de erro do runtime com `status`, `code` e `details`
- Convencoes de `correlation_id` e eventos de log

## Resultado esperado

- O projeto passa a ter uma camada base para edge functions e servicos externos
- As proximas fases deixam de depender de decisoes implcitas sobre payloads
- O runtime ganha um contrato claro para:
- entrada de webhook inbound
- processamento interno de mensagens
- envio proativo por API publica
- despacho de webhooks de saida

## O que ja foi consolidado

- Padrao de erro do runtime
- Padrao de observabilidade com `correlation_id`
- Schemas `Zod` para contratos principais do runtime
- Convencoes de `x-api-key` para API publica
- Interfaces para adapters externos
- Registro central de providers
- Base de autenticador por header para API publica
- Resolver de contexto para envio proativo com escolha de instancia explicita ou default
- Resolver de `provider_secret_ref` para backends seguros
- Stubs controlados dos providers externos para destravar implementacao incremental

## Blocos da fase

### 1. Erros padronizados

- Classe `RuntimeError`
- Mapeamento estavel de erro para HTTP status
- Conversao de erro desconhecido em resposta segura

### 2. Observabilidade

- Geracao de `correlation_id`
- Contexto de execucao
- Formato padrao para eventos de log

### 3. Autenticacao de API publica

- Extracao segura de `x-api-key`
- Mascara de chave para logs
- Convencao de prefixo
- Validacao do payload de `POST /api/messages`

### 4. Contratos de validacao

- Evento inbound normalizado
- Comando de `process-message`
- Payload de dispatcher de webhook

### 5. Interfaces de providers

- `WhatsAppProvider`
- `AiProvider`
- `SpeechProvider`
- `VisionProvider`
- `PublicApiAuthenticator`
- `WebhookDispatcher`

## O que esta fase ainda nao faz

- Nao resolve segredos reais em um cofre/backend definitivo ainda
- Nao chama Evolution de verdade ainda
- Nao autentica `x-api-key` contra o banco ainda
- Nao implementa edge functions ainda

## Ponte para as proximas fases

- Fase 2 reutiliza contratos e validacoes ao montar o painel
- Fase 3 implementa `WhatsAppProvider` com Evolution
- Fase 4 usa o schema de inbound e o contexto de observabilidade
- Fase 7 pluga a autenticacao real por `x-api-key`
