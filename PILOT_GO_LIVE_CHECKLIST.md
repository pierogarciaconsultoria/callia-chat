# Pilot Go-Live Checklist

## Infraestrutura

- Frontend publicado com `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`
- Todas as migrations aplicadas no Supabase
- Todas as edge functions publicadas
- Secrets configurados no projeto Supabase

## Workspace piloto

- Workspace criado
- Branding revisado
- Domínio customizado definido ou backlog validado
- Time interno com perfis `owner/admin` configurados

## Canal WhatsApp

- Instância conectada
- QR autenticado
- Instância padrão marcada
- Webhook inbound respondendo

## Agente

- Prompt principal revisado
- FAQ principal cadastrada
- Produtos principais cadastrados
- Palavras de handoff revisadas
- Links de pagamento revisados

## Operação humana

- Inbox carrega lista de conversas
- Assumir conversa funciona
- Devolver ao bot funciona
- Envio manual humano funciona

## API pública

- Primeira API key criada
- `POST /messages` validado
- `POST /events` validado
- `GET /conversations` validado
- `GET /conversations/:id/messages` validado

## Webhooks de saída

- Webhook de teste cadastrado
- Segredo armazenado pelo cliente
- Validação de assinatura HMAC confirmada
- Retry de falha testado
- Evento `message.received` validado
- Evento `message.sent` validado

## Logs e auditoria

- Requests da API pública aparecem em `/logs`
- Outbound aparece em `/logs`
- Deliveries de webhooks aparecem em `/logs`
- Auditoria administrativa aparece em `/logs`

## Critério de entrada em piloto

- Fluxo ponta a ponta validado em ao menos 1 workspace
- Sem erro crítico de permissão
- Sem segredo sensível exposto no frontend
- Equipe sabe executar fallback manual em caso de falha
