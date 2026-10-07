alter table public.agent_configs
  add column if not exists external_agent_enabled boolean not null default false,
  add column if not exists human_pause_hours integer not null default 12;

alter table public.agent_configs
  drop constraint if exists agent_configs_human_pause_hours_check;

alter table public.agent_configs
  add constraint agent_configs_human_pause_hours_check
  check (human_pause_hours between 1 and 720);

create index if not exists idx_outbound_messages_conversation_queued
  on public.outbound_messages(conversation_id, queued_at desc);
