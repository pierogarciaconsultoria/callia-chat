# Project Board - Agent Hub

## Como usar este board

- Este arquivo e o guia operacional do projeto por fases.
- Cada fase carrega uma linha `- Status:` com um destes valores: `pending`, `in_progress`, `completed` ou `blocked`. Essa linha alimenta automaticamente a pagina `/acompanhamento`, sem edicao manual de codigo.
- O acompanhamento vivo do status acontece pelo board de tarefas da workspace.
- Sempre que eu iniciar uma fase, o status dela muda para `in_progress`.
- Sempre que eu concluir uma fase, o status dela muda para `completed` com um resumo do que foi entregue.
- Se uma fase depender de uma decisao sua, eu marco a fase atual com a pendencia antes de seguir.

## Legenda de status

- `pending`: fase ainda nao iniciada
- `in_progress`: fase em execucao
- `completed`: fase concluida e validada
- `blocked`: fase pausada por dependencia externa ou decisao pendente

## Ordem de execucao

1. Fundacao tecnica
2. Estrutura do backend e adapters
3. Painel do agente e configuracao do workspace
4. Conexao WhatsApp e gestao de instancias
5. Entrada de mensagens e webhook inbound
6. Pipeline de IA
7. Inbox, realtime e atendimento humano
8. API publica e chaves
9. Webhooks de saida, logs e auditoria
10. Acabamento, testes e go-live

## Fase 0 - Fundacao tecnica

- Objetivo: preparar a base segura do produto antes das funcionalidades operacionais.
- Escopo:
- revisar schema multi-tenant
- proteger segredos da Evolution fora do frontend
- adicionar branding e `custom_domain`
- ajustar idempotencia e rastreio de eventos
- definir contrato da instancia padrao por workspace
- Entregaveis:
- migracoes complementares do banco
- contratos tecnicos internos do MVP
- estrutura de dados pronta para multiplas instancias
- Criterio de entrada: base atual compilando e schema inicial aplicado
- Criterio de saida: schema endurecido, segredos protegidos e contratos fechados
- Dependencias: nenhuma
- Status: completed

## Fase 1 - Estrutura do backend e adapters

- Objetivo: montar a ossatura do runtime para evitar logica espalhada.
- Escopo:
- criar adapters para WhatsApp, IA, audio e visao
- padronizar validacao de payloads
- estruturar autenticacao por `x-api-key`
- definir padrao de logs, erros e `correlation_id`
- Entregaveis:
- camada base de integracoes
- helpers de auth e observabilidade
- estrutura inicial de edge functions
- Criterio de entrada: Fase 0 concluida
- Criterio de saida: runtime organizado e pronto para conectar casos de uso
- Dependencias: Fase 0
- Status: completed

## Fase 2 - Painel do agente e configuracao do workspace

- Objetivo: permitir configurar o workspace e o comportamento do agente pela interface.
- Escopo:
- tela `/agent`
- CRUD de FAQ
- CRUD de produtos
- configuracao de prompt, voz, handoff, horario e website
- branding com nome, logo, cores e dominio customizado
- Entregaveis:
- interface funcional de configuracao
- persistencia de dados reais no banco
- app shell refletindo branding basico
- Criterio de entrada: Fase 1 concluida
- Criterio de saida: workspace consegue configurar o agente sem editar codigo
- Dependencias: Fase 1
- Status: completed

## Fase 3 - Conexao WhatsApp e gestao de instancias

- Objetivo: conectar o workspace ao canal WhatsApp.
- Escopo:
- tela `/whatsapp`
- cadastro e gestao de multiplas instancias
- definicao da instancia padrao
- integracao com Evolution
- QR code, status e reconexao
- Entregaveis:
- fluxo de conexao funcional
- status atualizado por instancia
- filtro por instancia preparado para o inbox
- Criterio de entrada: Fase 1 concluida
- Criterio de saida: workspace conecta e administra uma ou mais instancias
- Dependencias: Fase 1
- Status: completed

## Fase 4 - Entrada de mensagens e webhook inbound

- Objetivo: receber mensagens com seguranca e consistencia.
- Escopo:
- edge function de webhook inbound
- validacao de token e instancia
- normalizacao do payload da Evolution
- idempotencia por evento
- criacao e atualizacao de conversas e mensagens
- Entregaveis:
- pipeline de entrada persistindo dados corretamente
- registros de eventos inbound
- associacao correta entre workspace, instancia e conversa
- Criterio de entrada: Fase 3 concluida
- Criterio de saida: mensagens inbound entram no sistema uma unica vez
- Dependencias: Fase 3
- Status: completed

## Fase 5 - Pipeline de IA

- Objetivo: construir o cerebro do atendimento automatico.
- Escopo:
- processamento de texto
- STT para audio
- visao para imagem
- montagem de contexto com historico, FAQ, produtos e site sincronizado
- guardrails de escopo
- handoff automatico por regras
- resposta outbound via provedor
- Entregaveis:
- edge function `process-message`
- sync manual de site
- resposta automatica funcional com fallback
- Criterio de entrada: Fase 4 concluida e Fase 2 concluida
- Criterio de saida: bot responde com contexto e respeita handoff
- Dependencias: Fase 2, Fase 4
- Status: completed

## Fase 6 - Inbox, realtime e atendimento humano

- Objetivo: entregar a ferramenta operacional do time humano.
- Escopo:
- tela `/inbox`
- lista de conversas do workspace
- filtro por instancia
- thread realtime
- assumir conversa
- devolver ao bot
- envio manual pelo atendente
- Entregaveis:
- inbox funcional com operacao humana ponta a ponta
- transicao entre modo bot e humano
- visualizacao por workspace com filtro operacional
- Criterio de entrada: Fase 4 concluida
- Criterio de saida: agente humano consegue operar conversas pelo painel
- Dependencias: Fase 4
- Status: completed

## Fase 7 - API publica e chaves

- Objetivo: abrir o hub para integracao com sistemas externos.
- Escopo:
- tela `/api-keys`
- gerar, rotacionar e revogar chaves
- implementar `POST /api/messages`
- implementar `POST /api/events`
- implementar leituras de conversas e mensagens
- auditar requests por workspace
- Entregaveis:
- API externa autenticada por `x-api-key`
- envio proativo funcional
- regra de `instance_id` opcional com fallback para instancia padrao
- Criterio de entrada: Fase 1 concluida e Fase 3 concluida
- Criterio de saida: cliente externo consegue enviar mensagem proativa e consultar dados
- Dependencias: Fase 1, Fase 3
- Status: completed

## Fase 8 - Webhooks de saida, logs e auditoria

- Objetivo: fechar o ciclo de integracao e governanca.
- Escopo:
- tela `/webhooks`
- CRUD de webhooks
- assinatura HMAC
- retries
- historico de entregas
- tela `/logs`
- Entregaveis:
- dispatcher de webhooks
- rastreio de entregas e falhas
- auditoria operacional visivel no painel
- Criterio de entrada: Fase 7 concluida
- Criterio de saida: eventos de saida chegam ao cliente com rastreabilidade
- Dependencias: Fase 7
- Status: completed

## Fase 9 - Acabamento, testes e go-live

- Objetivo: estabilizar o MVP para piloto real.
- Escopo:
- testes de RLS
- testes do fluxo principal
- hardening de permissoes e segredos
- documentacao tecnica e operacional
- checklist de deploy e onboarding
- Entregaveis:
- MVP validado para piloto
- documentacao minima de operacao
- checklist de producao
- Criterio de entrada: Fases 2 a 8 concluidas
- Criterio de saida: produto utilizavel por clientes piloto com fluxo ponta a ponta
- Dependencias: Fases 2 a 8
- Status: completed

## Forma de acompanhamento

- Acompanhamento estrategico: usar este arquivo como mapa do projeto.
- Acompanhamento operacional: usar o board vivo de tarefas com status por fase.
- A cada entrega relevante, registrar:
- fase afetada
- o que foi concluido
- pendencias abertas
- risco residual

## Ultima fase concluida

- `Fase 9 - Acabamento, testes e go-live`

## Proxima fase da fila

- `Roadmap base concluido`
