# Fase 2 - Painel do agente e configuracao do workspace

## Objetivo

Transformar o painel administrativo em uma area funcional para configuracao do agente e do workspace, substituindo placeholders por paginas reais e ligadas ao banco.

## Escopo da fase

- Tela `/agent`
- Configuracao de `agent_configs`
- CRUD de `FAQ`
- CRUD de `products`
- Tela `/settings`
- Configuracao de `workspace_branding`
- Edicao basica do nome do workspace

## Resultado esperado

- O owner/admin consegue configurar o comportamento do agente sem editar codigo
- O workspace passa a ter branding e white-label basicos salvos no banco
- FAQ e produtos deixam de ser apenas tabelas existentes no schema e passam a ter uso real no app

## Blocos da fase

### 1. Dados do agente

- `persona_prompt`
- `language`
- `ai_model`
- `website_url`
- `voice_enabled`
- `voice_id`
- `business_hours`
- `handoff_keywords`

### 2. Base de conhecimento

- Perguntas frequentes
- Catalogo de produtos
- Edicao, criacao e remocao pelo painel

### 3. White-label

- `display_name`
- `logo_url`
- `primary_color`
- `secondary_color`
- `custom_domain`
- `support_email`

### 4. Experiencia de workspace

- Uso do `currentWorkspace`
- Permissoes por role
- Salvar e refletir alteracoes do workspace no shell

## O que esta fase nao cobre

- Upload real de arquivos/media
- Sincronizacao automatica do site
- Busca vetorial ou RAG
- Tela de WhatsApp
- Edge functions de pipeline

## Ponte para as proximas fases

- Fase 3 usa as configuracoes do workspace e branding ja persistidas
- Fase 4 usa `agent_configs`, `faqs` e `products` como contexto do atendimento
- Fase 5 usa os dados do agente para montar prompts e regras de handoff

## Fechamento da fase

- Pagina `/agent` implementada com persistencia real
- Pagina `/settings` implementada com branding e dominio customizado
- CRUD de `FAQ` e `products` funcional no painel
- Branding refletido no `AppLayout`
- Configuracoes avancadas de `payment_links` e `follow_up_rules` preparadas para as fases seguintes
