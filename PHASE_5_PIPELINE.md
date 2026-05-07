# Fase 5 - Pipeline de IA

## Objetivo

Automatizar o atendimento com contexto do workspace, guardrails, handoff e resposta outbound a partir das mensagens recebidas no WhatsApp.

## Entregas da fase

- Edge function `process-message`
- Edge function `send-message`
- Pre-processamento de texto, áudio e imagem
- Prompt com persona, FAQ, produtos, links de pagamento e histórico
- Guardrails de escopo e handoff por palavra-chave
- Persistência de respostas em `messages` e `outbound_messages`
- Envio outbound via Evolution
- Disparo automático do pipeline a partir do webhook inbound

## Fluxo implementado

1. `whatsapp-webhook` persiste a mensagem inbound
2. Se a mensagem for do cliente, chama `process-message`
3. `process-message` carrega `agent_config`, `faqs`, `products`, conversa e histórico
4. Áudio tenta transcrição e imagem tenta análise visual quando houver provider configurado
5. Regras de handoff verificam palavras-chave do workspace
6. O sistema monta prompt contextual e tenta gerar resposta com provider compatível
7. Se não houver provider ou se ele falhar, usa fallback determinístico com FAQ/produtos
8. A resposta é persistida e enviada via `send-message`

## Providers e fallback

- `AI_COMPAT_API_KEY` e `AI_COMPAT_BASE_URL` habilitam geração de texto compatível com OpenAI
- `OPENAI_API_KEY` também serve como fallback para texto, visão e transcrição
- Sem provider configurado, o sistema continua funcionando com respostas de fallback e handoff

## Resultado esperado

- O sistema já responde mensagens reais com contexto do workspace
- Áudio e imagem entram no pipeline com fallback seguro
- Conversas podem migrar para `human` quando houver handoff
- A base fica pronta para a fase 6 de inbox e operação humana
