-- Assistente do painel: propostas de alteração (tabela de preços, políticas, horário, regras) que o administrador
-- confirma antes de gravar. Quem grava é a function assistant (service_role); o cliente só lê as próprias propostas.
create table public.assistant_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('price_table', 'policy', 'business_hours', 'guardrails')),
  title text not null,
  -- Linhas "de → para" mostradas ao administrador antes de confirmar.
  changes text[] not null default '{}',
  -- Estado novo a gravar (tabela completa, política, horário...), já validado.
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'discarded', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  applied_at timestamptz
);
create index assistant_proposals_workspace_idx on public.assistant_proposals(workspace_id, created_at desc);
alter table public.assistant_proposals enable row level security;
create policy assistant_proposals_select on public.assistant_proposals for select to authenticated
  using (public.is_workspace_admin(workspace_id));
-- Os privilégios padrão do Supabase dão "all" em tabelas novas; aqui o cliente só lê (quem grava é a function).
revoke insert, update, delete on public.assistant_proposals from anon, authenticated;
grant select on public.assistant_proposals to authenticated;
grant all on public.assistant_proposals to service_role;
-- Mesmo endurecimento para as assinaturas (a RLS já bloqueava; agora o privilégio também).
revoke insert, update, delete on public.workspace_subscriptions from anon, authenticated;
