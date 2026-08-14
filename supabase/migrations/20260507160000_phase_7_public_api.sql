create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  prefix text not null default 'ah',
  key_hash text not null unique,
  last4 text not null,
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  last_used_ip text,
  last_used_user_agent text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The initial schema already creates api_keys. Keep this migration compatible
-- with both a fresh database and an existing MVP database.
alter table public.api_keys
  alter column prefix set default 'ah',
  add column if not exists last4 text,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null,
  add column if not exists last_used_ip text,
  add column if not exists last_used_user_agent text,
  add column if not exists expires_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.api_keys
set last4 = right(prefix, 4)
where last4 is null;

alter table public.api_keys
  alter column last4 set not null;

create index if not exists api_keys_workspace_created_idx
  on public.api_keys(workspace_id, created_at desc);

create unique index if not exists api_keys_workspace_name_active_idx
  on public.api_keys(workspace_id, lower(name))
  where revoked_at is null;

alter table public.api_keys enable row level security;

drop policy if exists "ak_select" on public.api_keys;
drop policy if exists "ak_insert" on public.api_keys;
drop policy if exists "ak_update" on public.api_keys;
drop policy if exists "ak_delete" on public.api_keys;
drop policy if exists "api_keys_select_admin" on public.api_keys;
drop policy if exists "api_keys_insert_admin" on public.api_keys;
drop policy if exists "api_keys_update_admin" on public.api_keys;
drop policy if exists "api_keys_delete_admin" on public.api_keys;

create policy "api_keys_select_admin" on public.api_keys
  for select to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "api_keys_insert_admin" on public.api_keys
  for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "api_keys_update_admin" on public.api_keys
  for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "api_keys_delete_admin" on public.api_keys
  for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

drop trigger if exists trg_api_keys_updated on public.api_keys;
create trigger trg_api_keys_updated before update on public.api_keys
  for each row execute function public.set_updated_at();

create table if not exists public.public_api_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  event_name text not null,
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists public_api_events_workspace_created_idx
  on public.public_api_events(workspace_id, created_at desc);

create unique index if not exists public_api_events_workspace_external_idx
  on public.public_api_events(workspace_id, event_name, external_id)
  where external_id is not null;

alter table public.public_api_events enable row level security;

drop policy if exists "public_api_events_select_member" on public.public_api_events;
create policy "public_api_events_select_member" on public.public_api_events
  for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));

create table if not exists public.public_api_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  endpoint text not null,
  method text not null,
  status_code int not null,
  request_body jsonb not null default '{}'::jsonb,
  response_body jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists public_api_requests_workspace_created_idx
  on public.public_api_requests(workspace_id, created_at desc);

create index if not exists public_api_requests_api_key_idx
  on public.public_api_requests(api_key_id, created_at desc);

create index if not exists public_api_requests_idempotency_idx
  on public.public_api_requests(workspace_id, api_key_id, endpoint, method, idempotency_key)
  where idempotency_key is not null;

alter table public.public_api_requests enable row level security;

drop policy if exists "public_api_requests_select_admin" on public.public_api_requests;
create policy "public_api_requests_select_admin" on public.public_api_requests
  for select to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));
