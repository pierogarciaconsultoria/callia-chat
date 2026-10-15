-- Fase 10 - Base de conhecimento por workspace (neutra de segmento).

create extension if not exists vector with schema extensions;

create type public.knowledge_source_type as enum ('text', 'file', 'url', 'faq', 'product');
create type public.knowledge_index_status as enum ('pending', 'indexing', 'indexed', 'error');

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  type public.knowledge_source_type not null,
  content text not null default '',
  file_path text,
  source_url text,
  category text,
  record_id uuid,
  is_active boolean not null default true,
  index_status public.knowledge_index_status not null default 'pending',
  index_error text,
  indexed_at timestamptz,
  chunk_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_sources_workspace_idx
  on public.knowledge_sources(workspace_id);

create index knowledge_sources_workspace_status_idx
  on public.knowledge_sources(workspace_id, index_status);

-- One mirrored row per faq/product; free-standing sources have no record_id.
create unique index knowledge_sources_record_idx
  on public.knowledge_sources(workspace_id, type, record_id)
  where record_id is not null;

alter table public.knowledge_sources enable row level security;

create policy "knowledge_sources_select_member" on public.knowledge_sources
  for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));

create policy "knowledge_sources_insert_admin" on public.knowledge_sources
  for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "knowledge_sources_update_admin" on public.knowledge_sources
  for update to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "knowledge_sources_delete_admin" on public.knowledge_sources
  for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

create trigger trg_knowledge_sources_updated before update on public.knowledge_sources
  for each row execute function public.set_updated_at();

-- No auto-pending trigger here: knowledge-index writes the extracted body back
-- into content, and a content-diff trigger would flip that same row to pending
-- and reindex it forever. Writers set index_status = 'pending' explicitly.

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  content text not null,
  position int not null,
  embedding extensions.vector(1536),
  tsv tsvector generated always as (to_tsvector('portuguese', content)) stored,
  created_at timestamptz not null default now(),
  unique (source_id, position)
);

create index knowledge_chunks_workspace_idx
  on public.knowledge_chunks(workspace_id);

create index knowledge_chunks_tsv_idx
  on public.knowledge_chunks using gin(tsv);

create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw(embedding extensions.vector_cosine_ops);

alter table public.knowledge_chunks enable row level security;

create policy "knowledge_chunks_select_member" on public.knowledge_chunks
  for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));

create policy "knowledge_chunks_insert_admin" on public.knowledge_chunks
  for insert to authenticated
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "knowledge_chunks_delete_admin" on public.knowledge_chunks
  for delete to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

-- faqs and products stay editable through their own tables and mirror into sources.
create or replace function public.sync_faq_knowledge_source()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.knowledge_sources where type = 'faq' and record_id = old.id;
    return old;
  end if;

  insert into public.knowledge_sources (workspace_id, title, type, content, record_id, is_active)
  values (
    new.workspace_id,
    left(new.question, 300),
    'faq',
    new.question || E'\n' || new.answer,
    new.id,
    new.is_active
  )
  on conflict (workspace_id, type, record_id) where record_id is not null
  do update set
    title = excluded.title,
    content = excluded.content,
    is_active = excluded.is_active,
    index_status = 'pending',
    index_error = null,
    indexed_at = null,
    chunk_count = 0;

  return new;
end; $$;

create trigger on_faq_changed after insert or update or delete on public.faqs
  for each row execute function public.sync_faq_knowledge_source();

create or replace function public.sync_product_knowledge_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  body text;
begin
  if tg_op = 'DELETE' then
    delete from public.knowledge_sources where type = 'product' and record_id = old.id;
    return old;
  end if;

  body := concat_ws(
    E'\n',
    new.name,
    coalesce(new.description, ''),
    case when new.price is not null
      then new.currency || ' ' || new.price::text
      else '' end,
    coalesce(new.link, '')
  );

  insert into public.knowledge_sources (workspace_id, title, type, content, record_id, is_active)
  values (new.workspace_id, left(new.name, 300), 'product', body, new.id, new.is_active)
  on conflict (workspace_id, type, record_id) where record_id is not null
  do update set
    title = excluded.title,
    content = excluded.content,
    is_active = excluded.is_active,
    index_status = 'pending',
    index_error = null,
    indexed_at = null,
    chunk_count = 0;

  return new;
end; $$;

create trigger on_product_changed after insert or update or delete on public.products
  for each row execute function public.sync_product_knowledge_source();

-- Hybrid retrieval. SECURITY INVOKER on purpose: RLS keeps a caller inside its
-- own workspaces even though the function is callable over PostgREST.
create or replace function public.knowledge_search(
  _workspace_id uuid,
  _query text,
  _query_embedding extensions.vector default null,
  _limit int default 5
)
returns table (
  id uuid,
  source_id uuid,
  title text,
  content text,
  category text,
  score double precision
)
language sql stable set search_path = public, extensions as $$
  with keyword as (
    select c.id,
           c.source_id,
           s.title,
           c.content,
           s.category,
           ts_rank_cd(c.tsv, websearch_to_tsquery('portuguese', _query))::double precision as score
    from public.knowledge_chunks c
    join public.knowledge_sources s on s.id = c.source_id
    where c.workspace_id = _workspace_id
      and s.is_active
      and c.tsv @@ websearch_to_tsquery('portuguese', _query)
    order by score desc
    limit _limit * 4
  ),
  similar as (
    select c.id,
           c.source_id,
           s.title,
           c.content,
           s.category,
           (1 - (c.embedding <=> _query_embedding))::double precision as score
    from public.knowledge_chunks c
    join public.knowledge_sources s on s.id = c.source_id
    where _query_embedding is not null
      and c.workspace_id = _workspace_id
      and s.is_active
      and c.embedding is not null
    order by c.embedding <=> _query_embedding
    limit _limit * 4
  ),
  merged as (
    select * from keyword
    union all
    select * from similar
  )
  select id, source_id, title, content, category, max(score) as score
  from merged
  group by id, source_id, title, content, category
  order by score desc
  limit _limit;
$$;

-- Private uploads, one folder per workspace, same layout as wa-media.
insert into storage.buckets (id, name, public)
values ('knowledge-files', 'knowledge-files', false)
on conflict (id) do nothing;

create policy "knowledge_files_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'knowledge-files'
  and exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(name))[1]
      and public.is_workspace_member(w.id, auth.uid())
  )
);

create policy "knowledge_files_write" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'knowledge-files'
  and exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(name))[1]
      and public.is_workspace_admin(w.id, auth.uid())
  )
);

create policy "knowledge_files_replace" on storage.objects
for update to authenticated
using (
  bucket_id = 'knowledge-files'
  and exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(name))[1]
      and public.is_workspace_admin(w.id, auth.uid())
  )
);

create policy "knowledge_files_remove" on storage.objects
for delete to authenticated
using (
  bucket_id = 'knowledge-files'
  and exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(name))[1]
      and public.is_workspace_admin(w.id, auth.uid())
  )
);
