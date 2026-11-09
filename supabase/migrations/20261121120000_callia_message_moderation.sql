-- Moderação de mensagens na inbox (function message-actions):
--  * "Apagar para todos": a mensagem enviada pela equipe ou pelo bot é apagada no WhatsApp do cliente (Evolution),
--    dentro da janela que o WhatsApp permite (~2 dias). O registro fica para auditoria, com deleted_at/deleted_by.
--    deleted_by nulo = apagada pelo celular conectado (o webhook reconhece a revogação).
--  * "Ocultar no painel" (admin): some da inbox da equipe sem mexer no WhatsApp; hidden_at/hidden_by. Reversível.
-- Nenhuma escrita direta pelo painel: messages continua sem política de update para authenticated.
alter table public.messages
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id) on delete set null,
  add column hidden_at timestamptz,
  add column hidden_by uuid references auth.users(id) on delete set null;
