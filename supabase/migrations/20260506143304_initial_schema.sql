-- AI Agent Hub multi-tenant schema

-- Enums
create type public.app_role as enum ('owner', 'admin', 'agent');
create type public.conversation_mode as enum ('bot', 'human');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_type as enum ('text','audio','image','video','document','system');
create type public.message_sender as enum ('customer','bot','agent','system');
create type public.whatsapp_status as enum ('disconnected','connecting','qr','connected','error');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "p_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "p_update_own" on public.profiles for update to authenticated using (id = auth.uid());
create policy "p_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Workspaces
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
create trigger trg_workspaces_updated before update on public.workspaces
  for each row execute function public.set_updated_at();

-- Workspace members (roles separate from profile)
create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'agent',
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index on public.workspace_members(user_id);
create index on public.workspace_members(workspace_id);
alter table public.workspace_members enable row level security;

-- Security definer helpers
create or replace function public.is_workspace_member(_workspace_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.workspace_members
    where workspace_id = _workspace_id and user_id = _user_id);
$$;

create or replace function public.has_workspace_role(_workspace_id uuid, _user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.workspace_members
    where workspace_id = _workspace_id and user_id = _user_id and role = _role);
$$;

create or replace function public.is_workspace_admin(_workspace_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.workspace_members
    where workspace_id = _workspace_id and user_id = _user_id and role in ('owner','admin'));
$$;

create policy "ws_select" on public.workspaces for select to authenticated
  using (public.is_workspace_member(id, auth.uid()));
create policy "ws_insert" on public.workspaces for insert to authenticated
  with check (owner_id = auth.uid());
create policy "ws_update" on public.workspaces for update to authenticated
  using (public.is_workspace_admin(id, auth.uid()));
create policy "ws_delete" on public.workspaces for delete to authenticated
  using (owner_id = auth.uid());

create policy "wm_select" on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "wm_insert" on public.workspace_members for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "wm_update" on public.workspace_members for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "wm_delete" on public.workspace_members for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-add owner as member when workspace created
create or replace function public.handle_new_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner') on conflict do nothing;
  insert into public.agent_configs (workspace_id) values (new.id) on conflict do nothing;
  return new;
end; $$;

-- API keys
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  created_by uuid references auth.users(id),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.api_keys(workspace_id);
alter table public.api_keys enable row level security;
create policy "ak_select" on public.api_keys for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "ak_insert" on public.api_keys for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "ak_update" on public.api_keys for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "ak_delete" on public.api_keys for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

-- Agent config (one per workspace)
create table public.agent_configs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  persona_prompt text not null default 'Você é um assistente de atendimento ao cliente prestativo, gentil e objetivo. Responda em português do Brasil.',
  language text not null default 'pt-BR',
  business_hours jsonb not null default '{"enabled": false}'::jsonb,
  website_url text,
  payment_links jsonb not null default '[]'::jsonb,
  voice_enabled boolean not null default false,
  voice_id text,
  handoff_keywords text[] not null default array['atendente','humano','reclamação']::text[],
  follow_up_rules jsonb not null default '[]'::jsonb,
  ai_model text not null default 'google/gemini-3-flash-preview',
  updated_at timestamptz not null default now()
);
alter table public.agent_configs enable row level security;
create policy "ac_select" on public.agent_configs for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "ac_insert" on public.agent_configs for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "ac_update" on public.agent_configs for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create trigger trg_ac_updated before update on public.agent_configs
  for each row execute function public.set_updated_at();

create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

-- Products
create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2),
  currency text not null default 'BRL',
  link text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.products(workspace_id);
alter table public.products enable row level security;
create policy "pr_select" on public.products for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "pr_insert" on public.products for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "pr_update" on public.products for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "pr_delete" on public.products for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create trigger trg_pr_updated before update on public.products
  for each row execute function public.set_updated_at();

-- FAQs
create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  question text not null,
  answer text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.faqs(workspace_id);
alter table public.faqs enable row level security;
create policy "fq_select" on public.faqs for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "fq_insert" on public.faqs for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "fq_update" on public.faqs for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "fq_delete" on public.faqs for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create trigger trg_fq_updated before update on public.faqs
  for each row execute function public.set_updated_at();

-- WhatsApp instances
create table public.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instance_name text not null unique,
  display_name text,
  status public.whatsapp_status not null default 'disconnected',
  phone_number text,
  qr_code text,
  evolution_base_url text,
  evolution_api_key text,
  webhook_token text not null default encode(gen_random_bytes(24), 'hex'),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.whatsapp_instances(workspace_id);
alter table public.whatsapp_instances enable row level security;
create policy "wa_select" on public.whatsapp_instances for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "wa_insert" on public.whatsapp_instances for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "wa_update" on public.whatsapp_instances for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "wa_delete" on public.whatsapp_instances for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create trigger trg_wa_updated before update on public.whatsapp_instances
  for each row execute function public.set_updated_at();

-- Conversations
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  whatsapp_instance_id uuid references public.whatsapp_instances(id) on delete set null,
  customer_phone text not null,
  customer_name text,
  mode public.conversation_mode not null default 'bot',
  assigned_agent_id uuid references auth.users(id) on delete set null,
  last_message_at timestamptz not null default now(),
  unread_count int not null default 0,
  is_closed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, customer_phone)
);
create index on public.conversations(workspace_id, last_message_at desc);
alter table public.conversations enable row level security;
create policy "co_select" on public.conversations for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "co_update" on public.conversations for update to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "co_delete" on public.conversations for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create trigger trg_co_updated before update on public.conversations
  for each row execute function public.set_updated_at();

-- Messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction public.message_direction not null,
  sender public.message_sender not null,
  type public.message_type not null default 'text',
  content text,
  media_url text,
  transcription text,
  ai_model text,
  tokens_used int,
  agent_user_id uuid references auth.users(id),
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.messages(conversation_id, created_at);
create index on public.messages(workspace_id, created_at desc);
alter table public.messages enable row level security;
create policy "ms_select" on public.messages for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "ms_insert" on public.messages for insert to authenticated
  with check (public.is_workspace_member(workspace_id, auth.uid()));

-- Webhooks
create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  url text not null,
  events text[] not null default array['message.received','conversation.handoff','conversation.closed']::text[],
  secret text not null default encode(gen_random_bytes(32), 'hex'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.webhooks(workspace_id);
alter table public.webhooks enable row level security;
create policy "wh_select" on public.webhooks for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "wh_insert" on public.webhooks for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "wh_update" on public.webhooks for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
create policy "wh_delete" on public.webhooks for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  response_status int,
  response_body text,
  error text,
  attempted_at timestamptz not null default now()
);
create index on public.webhook_deliveries(webhook_id, attempted_at desc);
alter table public.webhook_deliveries enable row level security;
create policy "whd_select" on public.webhook_deliveries for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));

-- Audit logs
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_type text not null,
  actor_id text,
  action text not null,
  target text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs(workspace_id, created_at desc);
alter table public.audit_logs enable row level security;
create policy "al_select" on public.audit_logs for select to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

-- Realtime
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.whatsapp_instances;

-- Storage bucket for media
insert into storage.buckets (id, name, public) values ('wa-media','wa-media', false)
on conflict (id) do nothing;

create policy "wa_media_read" on storage.objects for select to authenticated
using (
  bucket_id = 'wa-media'
  and exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(name))[1]
      and public.is_workspace_member(w.id, auth.uid())
  )
);
