alter table public.agent_configs
  add column if not exists external_agent_enabled boolean not null default false,
  add column if not exists external_agent_url text,
  add column if not exists external_agent_secret_ref text,
  add column if not exists external_agent_timeout_ms integer not null default 25000;