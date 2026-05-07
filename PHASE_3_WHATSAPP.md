# Fase 3 - Conexao WhatsApp e gestao de instancias

## Objetivo

Implementar a gestao operacional das instancias de WhatsApp por workspace, com foco em Evolution API, QR code, status, webhook e instancia padrao.

## Entregas da fase

- Pagina `/whatsapp` implementada
- CRUD basico de instancias
- Suporte a multiplas instancias por workspace
- Definicao de instancia padrao
- Rotacao de webhook token
- URL de webhook por instancia
- Edge Function `evolution-connect`
- Edge Function `whatsapp-webhook`
- Migracao SQL para regras de default e unicidade por workspace

## Escopo funcional

### 1. Dados da instancia

- `instance_name`
- `display_name`
- `evolution_base_url`
- `provider_secret_ref`
- `phone_number`
- `provider_type`
- `status`
- `is_default`

### 2. Operacoes do painel

- Criar instancia
- Editar instancia
- Excluir instancia
- Conectar
- Atualizar status
- Desconectar
- Tornar padrao
- Rotacionar token do webhook

### 3. Integracao com Evolution

- Criacao remota da instancia
- Configuracao de webhook na Evolution
- Acionamento de conexao
- Consulta de `connectionState`
- Logout remoto

### 4. Webhook

- Endpoint por instancia com `instance_id` e `token`
- Atualizacao de QR code
- Atualizacao de status de conexao
- Base pronta para a fase 4 de entrada de mensagens

## Dependencias da fase

- Fase 0 para schema endurecido
- Fase 1 para runtime e adapters
- Fase 2 para painel autenticado e branding

## Fechamento esperado

- Workspace consegue cadastrar e operar uma ou mais instancias WhatsApp
- Sistema reflete QR e estado de conexao
- Existe uma estrategia clara para instancia padrao por workspace
- A base do webhook inbound fica pronta para evoluir na fase 4

## Fechamento da fase

- Pagina `/whatsapp` implementada com operacao real de instancias
- Edge function `evolution-connect` criada para create/connect/refresh/disconnect
- Edge function `whatsapp-webhook` criada para atualizar QR e status
- Migracao criada para instancia padrao segura por workspace
- Testes adicionados para helpers de status, QR e webhook URL
