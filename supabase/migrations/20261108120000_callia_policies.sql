-- Políticas e informações oficiais da empresa como registros (um fato em um só lugar), em vez de textos soltos
-- duplicados entre regras do agente, FAQ e base de conhecimento. Entram sempre no prompt do agente.

create table public.workspace_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Assunto curto (ex.: checkin, checkout, cancelamento, criancas, pets, fumo, silencio, pagamento, danos, comodidades, outro).
  topic text not null check (topic ~ '^[a-z0-9_]{2,40}$'),
  title text not null check (length(title) between 2 and 120),
  content text not null check (length(content) between 2 and 4000),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspace_policies_workspace_idx on public.workspace_policies(workspace_id, position);

alter table public.workspace_policies enable row level security;
create policy workspace_policies_select on public.workspace_policies for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy workspace_policies_write on public.workspace_policies for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
grant select, insert, update, delete on public.workspace_policies to authenticated;
grant all on public.workspace_policies to service_role;

create trigger trg_workspace_policies_updated before update on public.workspace_policies
  for each row execute function public.touch_updated_at();
