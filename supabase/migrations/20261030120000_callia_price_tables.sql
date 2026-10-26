-- Tabela de preços estruturada: o valor é calculado pelo Callia (noite a noite), nunca pela IA.

create table public.price_tables (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  currency text not null default 'BRL',
  active boolean not null default true,
  -- { default_period, periods: [{ id, name, min_nights, ranges: [[início, fim]] }], units: [{ name, product_id?, rates: [...] }] }
  data jsonb not null,
  source_id uuid references public.knowledge_sources(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index price_tables_one_active on public.price_tables(workspace_id) where active;
create trigger trg_price_tables_touch before update on public.price_tables for each row execute function public.touch_updated_at();

alter table public.price_tables enable row level security;
revoke all on public.price_tables from anon;
create policy price_tables_select on public.price_tables for select to authenticated
  using (public.is_workspace_member(workspace_id));
-- Gravação só pela function (valida o formato antes de salvar).
revoke insert, update, delete on public.price_tables from authenticated;
