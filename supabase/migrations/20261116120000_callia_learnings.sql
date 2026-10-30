-- Aprendizados do atendimento: uma vez por dia (ou a pedido do admin) a function `learnings` lê as conversas do
-- período, encontra o que a IA ficou devendo (transferiu, não soube, a equipe respondeu o que não estava na base,
-- perguntas que se repetem) e grava SUGESTÕES com evidência. Nada entra no agente sem um admin aprovar:
-- aprovar vira FAQ, política ou regra do agente (quem grava é a function; o painel só lê).

create table public.learning_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trigger text not null default 'schedule' check (trigger in ('schedule', 'manual')),
  requested_by uuid,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  conversations_analyzed integer not null default 0,
  suggestions_created integer not null default 0,
  model text,
  usage jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index learning_runs_workspace_idx on public.learning_runs(workspace_id, created_at desc);

create table public.learning_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid references public.learning_runs(id) on delete set null,
  kind text not null check (kind in ('faq', 'policy', 'guardrail')),
  -- Chave de deduplicação (assunto normalizado): a mesma sugestão em dias seguidos soma evidência em vez de repetir.
  fingerprint text not null check (length(fingerprint) between 2 and 120),
  title text not null check (length(title) between 2 and 160),
  -- Por que a sugestão existe (o que faltou, o que a equipe respondeu).
  rationale text not null check (length(rationale) <= 1200),
  -- faq: { question, answer | null }  policy: { topic, title, content, id | null }  guardrail: { text }
  payload jsonb not null default '{}'::jsonb,
  -- [{ conversation_id, contact, excerpts: [{ who: 'cliente'|'ia'|'equipe', text }] }]
  evidence jsonb not null default '[]'::jsonb,
  -- Em quantas conversas o assunto apareceu (soma entre análises).
  occurrences integer not null default 1 check (occurrences >= 1),
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  decided_by uuid,
  decided_at timestamptz,
  -- O que foi gravado ao aprovar (já com as edições do admin), para histórico.
  applied_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index learning_suggestions_workspace_idx on public.learning_suggestions(workspace_id, status, created_at desc);
create unique index learning_suggestions_pending_uniq on public.learning_suggestions(workspace_id, fingerprint) where status = 'pending';
create trigger trg_learning_suggestions_touch before update on public.learning_suggestions
  for each row execute function public.touch_updated_at();

alter table public.learning_runs enable row level security;
alter table public.learning_suggestions enable row level security;
create policy learning_runs_select on public.learning_runs for select to authenticated
  using (public.is_workspace_admin(workspace_id));
create policy learning_suggestions_select on public.learning_suggestions for select to authenticated
  using (public.is_workspace_admin(workspace_id));
-- Os privilégios padrão dão "all" em tabelas novas; o painel só lê (quem grava é a function, com service_role).
revoke all on public.learning_runs from anon;
revoke all on public.learning_suggestions from anon;
revoke insert, update, delete on public.learning_runs from authenticated;
revoke insert, update, delete on public.learning_suggestions from authenticated;
grant select on public.learning_runs to authenticated;
grant select on public.learning_suggestions to authenticated;
grant all on public.learning_runs to service_role;
grant all on public.learning_suggestions to service_role;

-- Quais empresas analisar na rodada agendada: agente ligado e alguma mensagem de cliente desde a última análise
-- concluída (ou nas últimas 24 h, na primeira vez). Chamada pela function com service_role.
create or replace function public.learning_due_workspaces() returns table (workspace_id uuid, since timestamptz)
language sql stable security definer set search_path = public as $$
  with last_run as (
    select r.workspace_id, max(r.period_end) as period_end
    from learning_runs r where r.status = 'done' group by r.workspace_id
  )
  select c.workspace_id, coalesce(l.period_end, now() - interval '24 hours') as since
  from agent_configs c
  join workspaces w on w.id = c.workspace_id and w.status in ('trial', 'active')
  left join last_run l on l.workspace_id = c.workspace_id
  where c.enabled
    and exists (
      select 1 from messages m
      where m.workspace_id = c.workspace_id and m.sender = 'customer'
        and m.created_at > coalesce(l.period_end, now() - interval '24 hours')
    )
$$;
revoke all on function public.learning_due_workspaces() from public, anon, authenticated;
grant execute on function public.learning_due_workspaces() to service_role;
