-- Assistente de configuração: persona e instruções geradas a partir do site, Instagram, documentos e textos da empresa.

-- Novos tipos de fonte: site inteiro (várias páginas numa fonte) e rede social.
alter table public.knowledge_sources drop constraint knowledge_sources_kind_check;
alter table public.knowledge_sources add constraint knowledge_sources_kind_check
  check (kind in ('faq', 'product', 'text', 'url', 'document', 'site', 'social'));
-- site: { max_pages, pages: [{ url, title }] } · social: { network, handle, fetched }
alter table public.knowledge_sources add column metadata jsonb not null default '{}'::jsonb;

-- Rascunhos gerados pela IA; só viram configuração quando o admin aplica.
create table public.agent_setup_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status text not null default 'ready' check (status in ('ready', 'applied', 'discarded')),
  source_ids uuid[] not null default '{}',
  extra_text text,
  model text,
  draft jsonb not null,
  usage jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  applied_sections text[]
);
create index agent_setup_drafts_workspace_idx on public.agent_setup_drafts(workspace_id, created_at desc);
alter table public.agent_setup_drafts enable row level security;
revoke all on public.agent_setup_drafts from anon;
create policy setup_drafts_select on public.agent_setup_drafts for select to authenticated
  using (public.is_workspace_admin(workspace_id));

-- Site e redes sociais contam como fontes do plano.
create or replace function public.workspace_usage(p_workspace_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'period_start', date_trunc('month', now()),
    'monthly_messages', (select count(*) from outbound_messages
      where workspace_id = p_workspace_id and status = 'sent' and origin in ('bot', 'public_api')
        and created_at >= date_trunc('month', now())),
    'monthly_inbound', (select count(*) from messages
      where workspace_id = p_workspace_id and direction = 'inbound' and created_at >= date_trunc('month', now())),
    'monthly_ai_runs', (select count(*) from agent_runs
      where workspace_id = p_workspace_id and status in ('replied', 'handoff') and created_at >= date_trunc('month', now())),
    'monthly_ai_tokens', (select coalesce(sum((usage->>'total_tokens')::bigint), 0) from agent_runs
      where workspace_id = p_workspace_id and created_at >= date_trunc('month', now())),
    'instances', (select count(*) from whatsapp_instances where workspace_id = p_workspace_id),
    'members', (select count(*) from workspace_members where workspace_id = p_workspace_id and not is_support),
    'knowledge_sources', (select count(*) from knowledge_sources
      where workspace_id = p_workspace_id and kind in ('text', 'url', 'document', 'site', 'social'))
  );
$$;
