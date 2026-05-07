-- Phase 0 foundation hardening

-- Workspace branding and white-label metadata
create table public.workspace_branding (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  display_name text,
  logo_url text,
  primary_color text,
  secondary_color text,
  custom_domain text unique,
  support_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_branding enable row level security;

create policy "wb_select" on public.workspace_branding for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "wb_insert" on public.workspace_branding for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "wb_update" on public.workspace_branding for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

create trigger trg_wb_updated before update on public.workspace_branding
  for each row execute function public.set_updated_at();

-- Harden WhatsApp instance settings for multiple instances per workspace.
alter table public.whatsapp_instances
  add column provider_type text not null default 'evolution',
  add column provider_secret_ref text,
  add column is_default boolean not null default false,
  add column connection_metadata jsonb not null default '{}'::jsonb;

create unique index uniq_whatsapp_default_per_workspace
  on public.whatsapp_instances(workspace_id)
  where is_default;

alter table public.whatsapp_instances
  drop column if exists evolution_api_key;

-- Inbound event ledger for webhook idempotency.
create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  whatsapp_instance_id uuid references public.whatsapp_instances(id) on delete set null,
  provider text not null default 'evolution',
  event_type text not null,
  provider_event_id text not null,
  payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'received',
  message_id uuid references public.messages(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index idx_inbound_events_workspace_received
  on public.inbound_events(workspace_id, received_at desc);
create index idx_inbound_events_processing_status
  on public.inbound_events(processing_status, received_at desc);

alter table public.inbound_events enable row level security;

create policy "ie_select" on public.inbound_events for select to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

-- Outbound event ledger for provider retries and delivery tracking.
create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  whatsapp_instance_id uuid references public.whatsapp_instances(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  provider text not null default 'evolution',
  payload jsonb not null default '{}'::jsonb,
  provider_message_id text,
  delivery_status text not null default 'queued',
  retry_count int not null default 0,
  last_error text,
  correlation_id uuid not null default gen_random_uuid(),
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz
);

create index idx_outbound_messages_workspace_queued
  on public.outbound_messages(workspace_id, queued_at desc);
create index idx_outbound_messages_delivery_status
  on public.outbound_messages(delivery_status, queued_at desc);

alter table public.outbound_messages enable row level security;

create policy "om_select" on public.outbound_messages for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));

-- Enrich webhook delivery tracking for retries and correlation.
alter table public.webhook_deliveries
  add column attempt_number int not null default 1,
  add column next_retry_at timestamptz,
  add column delivered_at timestamptz,
  add column correlation_id uuid not null default gen_random_uuid();

create index idx_webhook_deliveries_workspace_attempted
  on public.webhook_deliveries(workspace_id, attempted_at desc);

-- Ensure new workspaces always start with branding metadata.
create or replace function public.handle_new_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner') on conflict do nothing;

  insert into public.agent_configs (workspace_id)
  values (new.id) on conflict do nothing;

  insert into public.workspace_branding (workspace_id, display_name)
  values (new.id, new.name) on conflict do nothing;

  return new;
end; $$;

