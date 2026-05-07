# RLS Test Plan

## Objetivo

Executar uma bateria mínima manual antes do piloto para validar isolamento por workspace e permissões por papel.

## Perfis de teste

- `owner` do workspace A
- `admin` do workspace A
- `member` do workspace A
- `owner/admin` do workspace B

## Casos mínimos

### Workspace isolation

- Usuário do workspace A não enxerga `conversations` do workspace B
- Usuário do workspace A não enxerga `messages` do workspace B
- Usuário do workspace A não enxerga `whatsapp_instances` do workspace B
- Usuário do workspace A não enxerga `api_keys` do workspace B
- Usuário do workspace A não enxerga `webhooks` do workspace B

### Admin-only writes

- `member` não consegue criar `api_keys`
- `member` não consegue atualizar `webhooks`
- `member` não consegue rotacionar segredos
- `owner/admin` consegue executar ações administrativas

### Member reads

- `member` consegue ler `conversations`
- `member` consegue ler `messages`
- `member` consegue ler `webhook_deliveries`
- `member` consegue operar inbox no próprio workspace

### Audit and logs

- `admin` enxerga `audit_logs`
- `member` não deve acessar `audit_logs` administrativos, se a política assim exigir
- `public_api_requests` visível apenas para perfis autorizados

## Procedimento sugerido

1. Criar dois workspaces distintos
2. Criar usuários dedicados por papel
3. Popular dados mínimos nos dois tenants
4. Logar com cada usuário e validar UI
5. Validar também com queries SQL autenticadas, quando aplicável

## Resultado esperado

- Nenhum dado cruza tenants
- Escritas administrativas respeitam papel
- Leituras operacionais respeitam escopo do workspace
- Logs sensíveis continuam restritos
