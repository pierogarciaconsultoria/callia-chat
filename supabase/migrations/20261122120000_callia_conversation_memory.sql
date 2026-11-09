-- Memória da IA em conversas longas: a MarIA lê as últimas 40 mensagens na íntegra e, antes disso, um resumo
-- gerado pela própria IA (process-message) quando a conversa passa de 50 mensagens não resumidas.
-- ai_summary_through_seq = última mensagem (messages.seq) coberta pelo resumo; o histórico carregado começa depois dela.
alter table public.conversations
  add column ai_summary text,
  add column ai_summary_through_seq bigint;
