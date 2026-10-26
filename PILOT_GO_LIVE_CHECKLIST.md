# Checklist de go-live do piloto

## Plataforma
- [ ] `npm test`, `npm run test:sql` e `npm run test:e2e` verdes no commit publicado
- [ ] Migrations aplicadas; bucket `knowledge` e publicação realtime conferidos
- [ ] Secrets definidos; `CALLIA_ENCRYPTION_KEY` e `API_KEY_PEPPER` guardados em cofre
- [ ] `NO_VERIFY_JWT_FUNCTIONS` configurado; demais functions exigem JWT
- [ ] Cron do `webhook-dispatcher` ativo (`select * from cron.job`)
- [ ] Cadastro aberto desligado

## Plataforma SaaS
- [ ] Pelo menos 2 admins da plataforma (evita perder o acesso ao console)
- [ ] Planos revisados (limites, IA, agente externo, conectores); autoatendimento conforme a estratégia comercial
- [ ] Cliente do piloto criado pelo console com plano e status corretos
- [ ] Teste de suspensão e reativação num cliente de teste

## Workspace do piloto
- [ ] Branding (nome, logo, cores) e e-mail de suporte
- [ ] Persona, idioma, fuso e horário de atendimento revisados com o cliente
- [ ] Palavras-chave e mensagem de handoff aprovadas
- [ ] FAQ com as 20 perguntas mais comuns; catálogo e links de pagamento
- [ ] Simulador: 10 perguntas reais respondidas corretamente e 3 casos de transferência
- [ ] Instância principal `open`, marcada como padrão e estável por 24 h
- [ ] (Se usar) agente externo com URL HTTPS e segredo `EXTERNAL_AGENT_*` definido; teste de queda (fallback interno)
- [ ] (Se usar) conector hbook testado em `/settings` com datas reais e moeda correta

## Integração
- [ ] API key de produção gerada e entregue por canal seguro
- [ ] Envio proativo e ingestão testados pelo sistema do cliente
- [ ] Webhook de teste com `success` e assinatura validada pelo receptor

## Operação
- [ ] Equipe sabe assumir, responder, devolver ao bot e encerrar na inbox
- [ ] Equipe sabe que responder pelo celular pausa o bot naquela conversa
- [ ] Equipe sabe consultar `/logs` (agente, envios, API, webhooks, auditoria)
- [ ] Responsável de plantão definido para queda da instância

## Critérios de liberação
- Sem erros bloqueantes de autenticação ou RLS nos fluxos normais
- Instância principal estável
- API key e webhook de teste funcionando
- Equipe treinada em inbox, logs e webhooks
