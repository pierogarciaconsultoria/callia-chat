-- Fase 10 - Conectores de reserva por workspace (hbook).

create table public.workspace_connectors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_connectors_provider_check
    check (provider in ('hbook')),
  -- The hbook proxy is useless without the company id, so refuse a half-configured row.
  constraint workspace_connectors_hbook_company_check
    check (provider <> 'hbook' or coalesce(config ->> 'company_id', '') ~ '^[A-Za-z0-9-]+$')
);

create unique index workspace_connectors_workspace_provider_idx
  on public.workspace_connectors(workspace_id, provider);

alter table public.workspace_connectors enable row level security;

create policy "workspace_connectors_select_member" on public.workspace_connectors
  for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));

create policy "workspace_connectors_insert_admin" on public.workspace_connectors
  for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "workspace_connectors_update_admin" on public.workspace_connectors
  for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "workspace_connectors_delete_admin" on public.workspace_connectors
  for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

create trigger trg_workspace_connectors_updated before update on public.workspace_connectors
  for each row execute function public.set_updated_at();
