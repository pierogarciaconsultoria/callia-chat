-- Callia Chat — fundação multi-tenant (Fases 0 a 10).
-- Regra geral: toda tabela de aplicação tem RLS; sem política = acesso bloqueado.
-- Escritas sensíveis (mensagens, chaves, webhooks, instâncias) passam pelas edge functions (service_role).

create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Busca textual em português sem depender de acento ("horario" encontra "horário").
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'pt_unaccent') then
    create text search configuration public.pt_unaccent (copy = pg_catalog.portuguese);
    alter text search configuration public.pt_unaccent
      alter mapping for hword, hword_part, word with extensions.unaccent, portuguese_stem;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.workspace_role as enum ('owner', 'admin', 'agent');
create type public.app_role as enum ('platform_admin');
create type public.conversation_mode as enum ('bot', 'human', 'closed');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_sender as enum ('customer', 'bot', 'agent', 'system');

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'agent',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

-- Papéis de plataforma: nunca derivados de user_metadata (editável pelo próprio usuário).
create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.workspace_branding (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  display_name text,
  logo_url text,
  primary_color text not null default '#0f766e' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text not null default '#f59e0b' check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  custom_domain text unique,
  support_email text,
  updated_at timestamptz not null default now()
);

create table public.workspace_connectors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('hbook')),
  enabled boolean not null default false,
  -- hbook: { base_url, company_id, booking_link, currency, default_adults }
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, kind)
);

-- Helpers de RLS. SECURITY DEFINER evita recursão de políticas em workspace_members.
create or replace function public.is_workspace_member(_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = _workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = _workspace_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create or replace function public.has_app_role(_role public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = _role);
$$;

-- ---------------------------------------------------------------------------
-- Canal WhatsApp
-- ---------------------------------------------------------------------------
create table public.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  -- Nome da instância na Evolution (único no servidor Evolution).
  instance_name text not null unique,
  provider text not null default 'evolution',
  -- Nome do segredo de backend com a API key da Evolution. Nunca o valor.
  provider_secret_ref text not null default 'EVOLUTION_API_KEY'
    check (provider_secret_ref ~ '^EVOLUTION_[A-Z0-9_]+$'),
  status text not null default 'created'
    check (status in ('created', 'connecting', 'qr', 'open', 'close', 'error')),
  qr_code text,
  qr_updated_at timestamptz,
  phone_number text,
  profile_name text,
  webhook_token_hash text,
  webhook_token_rotated_at timestamptz,
  is_default boolean not null default false,
  last_connected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index whatsapp_instances_workspace_idx on public.whatsapp_instances(workspace_id);
create unique index whatsapp_instances_one_default
  on public.whatsapp_instances(workspace_id) where is_default;

-- Ledger de idempotência de eventos recebidos (Evolution e afins).
create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instance_id uuid references public.whatsapp_instances(id) on delete set null,
  provider text not null default 'evolution',
  event_type text not null,
  event_key text not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error text,
  payload jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, event_key)
);
create index inbound_events_created_idx on public.inbound_events(workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Atendimento
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instance_id uuid references public.whatsapp_instances(id) on delete set null,
  -- 'whatsapp' = Evolution; demais valores vêm da ingestão externa (ex.: whatsapp_cloud).
  channel text not null default 'whatsapp',
  contact_phone text not null,
  contact_name text,
  conversation_key text generated always as
    (channel || ':' || coalesce(instance_id::text, '-') || ':' || contact_phone) stored,
  mode public.conversation_mode not null default 'bot',
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  last_message_preview text,
  assigned_user_id uuid references auth.users(id) on delete set null,
  handoff_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, conversation_key)
);
create index conversations_inbox_idx on public.conversations(workspace_id, last_message_at desc nulls last);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  -- Ordem de chegada. O timestamp do WhatsApp tem resolução de segundos e empata em rajadas.
  seq bigint generated always as identity,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction public.message_direction not null,
  sender public.message_sender not null,
  type text not null default 'text'
    check (type in ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'reaction', 'unknown')),
  content text,
  media_url text,
  media_mime text,
  external_id text,
  status text not null default 'received'
    check (status in ('received', 'pending', 'sent', 'delivered', 'read', 'failed')),
  agent_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages(conversation_id, created_at, seq);
create unique index messages_external_id_uniq
  on public.messages(workspace_id, external_id) where external_id is not null;

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  instance_id uuid references public.whatsapp_instances(id) on delete set null,
  origin text not null check (origin in ('bot', 'agent', 'public_api', 'system')),
  to_phone text not null,
  type text not null default 'text',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_message_id text,
  idempotency_key text,
  error text,
  attempts integer not null default 0,
  correlation_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbound_messages_created_idx on public.outbound_messages(workspace_id, created_at desc);
create index outbound_messages_provider_idx on public.outbound_messages(provider_message_id);
create unique index outbound_messages_idem_uniq
  on public.outbound_messages(workspace_id, idempotency_key) where idempotency_key is not null;

create table public.agent_configs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default true,
  agent_name text not null default 'Assistente',
  persona_prompt text not null default
    'Você é um atendente cordial e objetivo. Responda em mensagens curtas, próprias para WhatsApp.',
  guardrails text,
  language text not null default 'pt-BR',
  ai_model text,
  temperature numeric(3,2) not null default 0.4 check (temperature between 0 and 2),
  website_url text,
  voice_enabled boolean not null default false,
  voice_id text,
  timezone text not null default 'America/Sao_Paulo',
  -- { "mon": [["08:00","18:00"]], ..., "sun": [] }
  business_hours jsonb not null default '{}'::jsonb,
  out_of_hours_message text,
  handoff_keywords text[] not null default array['atendente', 'falar com humano', 'falar com uma pessoa', 'pessoa de verdade'],
  handoff_message text not null default
    'Certo! Vou chamar alguém da nossa equipe para continuar o seu atendimento. Só um instante.',
  -- [{ "label": "Pix", "url": "https://...", "description": "..." }]
  payment_links jsonb not null default '[]'::jsonb,
  -- [{ "after_minutes": 60, "message": "..." }] — consumido por automação futura.
  follow_up_rules jsonb not null default '[]'::jsonb,
  reply_debounce_ms integer not null default 2500 check (reply_debounce_ms between 0 and 15000),
  external_agent_enabled boolean not null default false,
  external_agent_url text check (external_agent_url is null or external_agent_url ~ '^https://'),
  external_agent_secret_ref text check (external_agent_secret_ref is null or external_agent_secret_ref ~ '^EXTERNAL_AGENT_[A-Z0-9_]+$'),
  external_agent_timeout_ms integer not null default 25000 check (external_agent_timeout_ms between 1000 and 60000),
  updated_at timestamptz not null default now()
);

-- Uma linha por execução do agente; trigger_message_id único garante idempotência.
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  trigger_message_id uuid not null unique references public.messages(id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'replied', 'handoff', 'skipped', 'superseded', 'failed')),
  engine text check (engine in ('internal', 'external', 'fallback')),
  reason text,
  error text,
  latency_ms integer,
  usage jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index agent_runs_created_idx on public.agent_runs(workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Conhecimento
-- ---------------------------------------------------------------------------
create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  question text not null,
  answer text not null,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index faqs_workspace_idx on public.faqs(workspace_id, position);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2),
  currency text not null default 'BRL',
  url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_workspace_idx on public.products(workspace_id);

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('faq', 'product', 'text', 'url', 'document')),
  title text not null,
  -- faq/product: id da linha espelhada.
  origin_id uuid,
  content text,
  url text,
  storage_path text,
  mime_type text,
  status text not null default 'pending' check (status in ('pending', 'indexing', 'indexed', 'failed')),
  error text,
  chunk_count integer not null default 0,
  embedded boolean not null default false,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index knowledge_sources_origin_uniq
  on public.knowledge_sources(workspace_id, kind, origin_id) where origin_id is not null;
create index knowledge_sources_workspace_idx on public.knowledge_sources(workspace_id, created_at desc);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  tsv tsvector generated always as (to_tsvector('public.pt_unaccent'::regconfig, content)) stored,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);
create index knowledge_chunks_tsv_idx on public.knowledge_chunks using gin(tsv);
create index knowledge_chunks_workspace_idx on public.knowledge_chunks(workspace_id);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Integração
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  prefix text not null unique,
  key_hash text not null,
  last4 text not null,
  scopes text[] not null default array['*'],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_workspace_idx on public.api_keys(workspace_id);

create table public.public_api_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  method text not null,
  path text not null,
  status_code integer not null,
  error_code text,
  duration_ms integer,
  correlation_id text,
  ip text,
  created_at timestamptz not null default now()
);
create index public_api_requests_created_idx on public.public_api_requests(workspace_id, created_at desc);

create table public.public_api_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  external_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, external_id)
);

create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  url text not null check (url ~ '^https?://'),
  events text[] not null default array['message.received', 'message.sent', 'conversation.handoff', 'public_api.event.received'],
  active boolean not null default true,
  -- Segredo HMAC cifrado com AES-GCM (CALLIA_ENCRYPTION_KEY). Nunca em texto puro.
  secret_ciphertext text not null,
  secret_last4 text not null,
  max_attempts integer not null default 6 check (max_attempts between 1 and 12),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index webhooks_workspace_idx on public.webhooks(workspace_id);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'retrying', 'success', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status_code integer,
  last_error text,
  correlation_id text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index webhook_deliveries_due_idx on public.webhook_deliveries(next_attempt_at)
  where status in ('pending', 'retrying');
create index webhook_deliveries_created_idx on public.webhook_deliveries(workspace_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'api_key', 'system')),
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create trigger trg_workspaces_touch before update on public.workspaces for each row execute function public.touch_updated_at();
create trigger trg_branding_touch before update on public.workspace_branding for each row execute function public.touch_updated_at();
create trigger trg_connectors_touch before update on public.workspace_connectors for each row execute function public.touch_updated_at();
create trigger trg_instances_touch before update on public.whatsapp_instances for each row execute function public.touch_updated_at();
create trigger trg_conversations_touch before update on public.conversations for each row execute function public.touch_updated_at();
create trigger trg_agent_configs_touch before update on public.agent_configs for each row execute function public.touch_updated_at();
create trigger trg_faqs_touch before update on public.faqs for each row execute function public.touch_updated_at();
create trigger trg_products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger trg_sources_touch before update on public.knowledge_sources for each row execute function public.touch_updated_at();
create trigger trg_webhooks_touch before update on public.webhooks for each row execute function public.touch_updated_at();
