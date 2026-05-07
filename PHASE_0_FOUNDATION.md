# Fase 0 - Foundation Notes

## Objetivo

Fechar as decisoes estruturais que precisam existir antes das fases de integracao, inbox e API publica.

## Decisoes implementadas

- `workspace_id` continua sendo a chave primaria de isolamento logico do produto.
- Branding e white-label basico passam a existir em `workspace_branding`.
- `custom_domain` entra no schema desde a fundacao, mesmo antes da ativacao funcional.
- Credenciais da Evolution deixam de ficar em tabela lida pelo frontend.
- A tabela `whatsapp_instances` guarda apenas `provider_secret_ref`, nunca o segredo bruto.
- Cada workspace pode ter varias instancias, mas apenas uma pode ser `is_default = true`.
- Todo webhook inbound deve ser registrado em `inbound_events` para garantir idempotencia.
- Todo envio outbound passa a poder ser rastreado em `outbound_messages`.

## Convencoes de segredo

- Formato do `provider_secret_ref`: `provider:workspaceId:scope:targetId`
- Exemplo de segredo por instancia: `evolution:workspace-123:instance:instance-abc`
- O segredo real fica em um backend seguro e sera resolvido pelo runtime na fase de adapters.

## Regra de roteamento por instancia

- Se `instance_id` vier na chamada publica, o runtime usa essa instancia.
- Se `instance_id` nao vier, o runtime precisa usar a instancia default do workspace.
- Se nao houver instancia default, a chamada deve falhar com erro explicito.
- Se houver mais de uma instancia default, isso e violacao de integridade.

## Contratos fechados nesta fase

- Evento inbound normalizado
- Comando interno para `process-message`
- Payload de envio proativo da API publica
- Payload de dispatcher de webhook
- Estrategia de selecao de instancia: `explicit` ou `default`

## O que fica para a Fase 1

- Resolver `provider_secret_ref` contra um backend seguro real
- Implementar adapters de WhatsApp, IA, audio e visao
- Criar helpers de autenticacao por `x-api-key`
- Padronizar logs, erros e `correlation_id` no runtime
