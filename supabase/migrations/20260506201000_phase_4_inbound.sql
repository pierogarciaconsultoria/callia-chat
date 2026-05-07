-- Phase 4 - inbound processing hardening

create unique index if not exists uniq_messages_workspace_external_id
  on public.messages(workspace_id, external_id)
  where external_id is not null;

create index if not exists idx_messages_conversation_external
  on public.messages(conversation_id, external_id)
  where external_id is not null;

create index if not exists idx_conversations_workspace_instance_phone
  on public.conversations(workspace_id, whatsapp_instance_id, customer_phone);
