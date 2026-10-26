-- RLS, privilégios por coluna, RPCs transacionais e espelhamento da base de conhecimento.

-- ---------------------------------------------------------------------------
-- RLS ligado em todas as tabelas de aplicação
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.user_roles enable row level security;
alter table public.workspace_branding enable row level security;
alter table public.workspace_connectors enable row level security;
alter table public.whatsapp_instances enable row level security;
alter table public.inbound_events enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.agent_configs enable row level security;
alter table public.agent_runs enable row level security;
alter table public.faqs enable row level security;
alter table public.products enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.api_keys enable row level security;
alter table public.public_api_requests enable row level security;
alter table public.public_api_events enable row level security;
alter table public.webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.audit_logs enable row level security;

-- Nada para anon.
revoke all on all tables in schema public from anon;

-- Tenancy
create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));

create policy members_select on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy user_roles_self on public.user_roles for select to authenticated
  using (user_id = auth.uid());

create policy branding_select on public.workspace_branding for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy branding_write on public.workspace_branding for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));

create policy connectors_admin on public.workspace_connectors for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));

-- Canal: leitura para membros (filtro da inbox); escrita só via evolution-connect.
create policy instances_select on public.whatsapp_instances for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy inbound_events_select on public.inbound_events for select to authenticated
  using (public.is_workspace_admin(workspace_id));

-- Atendimento
create policy conversations_select on public.conversations for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy conversations_update on public.conversations for update to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy messages_select on public.messages for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy outbound_select on public.outbound_messages for select to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy agent_configs_select on public.agent_configs for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy agent_configs_write on public.agent_configs for update to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (public.is_workspace_admin(workspace_id));

-- Conhecimento
create policy faqs_select on public.faqs for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy faqs_write on public.faqs for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
create policy products_select on public.products for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy products_write on public.products for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
create policy sources_select on public.knowledge_sources for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy sources_write on public.knowledge_sources for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
create policy chunks_select on public.knowledge_chunks for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Integração (leitura administrativa; escrita só pelas functions)
create policy api_keys_select on public.api_keys for select to authenticated
  using (public.is_workspace_admin(workspace_id));
create policy api_requests_select on public.public_api_requests for select to authenticated
  using (public.is_workspace_admin(workspace_id));
create policy api_events_select on public.public_api_events for select to authenticated
  using (public.is_workspace_admin(workspace_id));
create policy webhooks_select on public.webhooks for select to authenticated
  using (public.is_workspace_admin(workspace_id));
create policy deliveries_select on public.webhook_deliveries for select to authenticated
  using (public.is_workspace_admin(workspace_id));
create policy audit_select on public.audit_logs for select to authenticated
  using (public.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Privilégios por coluna: hashes e segredos cifrados nunca chegam ao frontend.
-- ---------------------------------------------------------------------------
revoke select on public.api_keys from authenticated;
grant select (id, workspace_id, name, prefix, last4, scopes, created_by, created_at, last_used_at, expires_at, revoked_at)
  on public.api_keys to authenticated;

revoke select on public.webhooks from authenticated;
grant select (id, workspace_id, name, url, events, active, secret_last4, max_attempts, created_by, created_at, updated_at)
  on public.webhooks to authenticated;

revoke select on public.whatsapp_instances from authenticated;
grant select (id, workspace_id, name, instance_name, provider, status, qr_code, qr_updated_at, phone_number,
  profile_name, is_default, last_connected_at, last_error, webhook_token_rotated_at, created_at, updated_at)
  on public.whatsapp_instances to authenticated;

-- Inbox só altera modo, não-lidas e responsável.
revoke update on public.conversations from authenticated;
grant update (mode, unread_count, assigned_user_id, handoff_at) on public.conversations to authenticated;

-- O admin edita a configuração do agente, mas não troca o workspace da linha.
revoke update on public.agent_configs from authenticated;
grant update (enabled, agent_name, persona_prompt, guardrails, language, ai_model, temperature, website_url,
  voice_enabled, voice_id, timezone, business_hours, out_of_hours_message, handoff_keywords, handoff_message,
  payment_links, follow_up_rules, reply_debounce_ms, external_agent_enabled, external_agent_url,
  external_agent_secret_ref, external_agent_timeout_ms)
  on public.agent_configs to authenticated;

-- ---------------------------------------------------------------------------
-- Onboarding e equipe
-- ---------------------------------------------------------------------------
create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  v_slug := trim(both '-' from regexp_replace(lower(extensions.unaccent(p_name)), '[^a-z0-9]+', '-', 'g'));
  v_slug := coalesce(nullif(v_slug, ''), 'workspace') || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

  insert into workspaces(name, slug, created_by) values (trim(p_name), v_slug, auth.uid()) returning id into v_id;
  insert into workspace_members(workspace_id, user_id, role) values (v_id, auth.uid(), 'owner');
  insert into workspace_branding(workspace_id, display_name) values (v_id, trim(p_name));
  insert into agent_configs(workspace_id) values (v_id);
  insert into audit_logs(workspace_id, actor_user_id, action, entity, entity_id)
    values (v_id, auth.uid(), 'workspace.created', 'workspace', v_id::text);
  return v_id;
end $$;

create or replace function public.list_workspace_members(p_workspace_id uuid)
returns table (user_id uuid, email text, role public.workspace_role, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from workspace_members m join auth.users u on u.id = m.user_id
  where m.workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
  order by m.created_at;
$$;

-- Adiciona um usuário já cadastrado (cadastro aberto fica desligado por padrão).
create or replace function public.add_workspace_member(p_workspace_id uuid, p_email text, p_role public.workspace_role)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_caller_role public.workspace_role;
begin
  select role into v_caller_role from workspace_members where workspace_id = p_workspace_id and user_id = auth.uid();
  if v_caller_role is null or v_caller_role = 'agent' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'only_owner_can_grant_owner' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  insert into workspace_members(workspace_id, user_id, role) values (p_workspace_id, v_user, p_role)
    on conflict (workspace_id, user_id) do update set role = excluded.role;
  insert into audit_logs(workspace_id, actor_user_id, action, entity, entity_id, details)
    values (p_workspace_id, auth.uid(), 'member.upserted', 'user', v_user::text, jsonb_build_object('role', p_role));
  return v_user;
end $$;

create or replace function public.remove_workspace_member(p_workspace_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_target_role public.workspace_role;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select role into v_target_role from workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
  if v_target_role = 'owner' and (select count(*) from workspace_members where workspace_id = p_workspace_id and role = 'owner') <= 1 then
    raise exception 'last_owner' using errcode = '42501';
  end if;
  delete from workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
  insert into audit_logs(workspace_id, actor_user_id, action, entity, entity_id)
    values (p_workspace_id, auth.uid(), 'member.removed', 'user', p_user_id::text);
end $$;

-- ---------------------------------------------------------------------------
-- Entrada de mensagens (atômica: conversa + mensagem + contadores)
-- Usada por whatsapp-webhook e por /messages/ingest.
-- ---------------------------------------------------------------------------
create or replace function public.record_message(
  p_workspace_id uuid,
  p_instance_id uuid,
  p_channel text,
  p_contact_phone text,
  p_contact_name text,
  p_direction public.message_direction,
  p_sender public.message_sender,
  p_type text,
  p_content text,
  p_media_url text default null,
  p_media_mime text default null,
  p_external_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_at timestamptz default now(),
  p_conversation_metadata jsonb default '{}'::jsonb,
  p_status text default 'received'
)
returns table (conversation_id uuid, message_id uuid, duplicate boolean, conversation_mode public.conversation_mode)
language plpgsql security definer set search_path = public as $$
declare
  v_conv_id uuid;
  v_mode public.conversation_mode;
  v_msg_id uuid;
  v_is_customer boolean := (p_direction = 'inbound' and p_sender = 'customer');
begin
  if p_external_id is not null then
    select m.id, m.conversation_id into v_msg_id, v_conv_id
      from messages m where m.workspace_id = p_workspace_id and m.external_id = p_external_id;
    if v_msg_id is not null then
      select c.mode into v_mode from conversations c where c.id = v_conv_id;
      return query select v_conv_id, v_msg_id, true, v_mode;
      return;
    end if;
  end if;

  insert into conversations as c (workspace_id, instance_id, channel, contact_phone, contact_name, metadata)
  values (p_workspace_id, p_instance_id, p_channel, p_contact_phone, nullif(trim(p_contact_name), ''), coalesce(p_conversation_metadata, '{}'::jsonb))
  on conflict (workspace_id, conversation_key) do update
    set contact_name = coalesce(c.contact_name, excluded.contact_name),
        metadata = c.metadata || excluded.metadata
  returning c.id, c.mode into v_conv_id, v_mode;

  insert into messages (workspace_id, conversation_id, direction, sender, type, content, media_url, media_mime,
                        external_id, status, metadata, created_at)
  values (p_workspace_id, v_conv_id, p_direction, p_sender, coalesce(p_type, 'text'), p_content, p_media_url,
          p_media_mime, p_external_id, coalesce(p_status, 'received'), coalesce(p_metadata, '{}'::jsonb),
          coalesce(p_created_at, now()))
  on conflict (workspace_id, external_id) where external_id is not null do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    -- Corrida com outra entrega do mesmo evento.
    select m.id into v_msg_id from messages m where m.workspace_id = p_workspace_id and m.external_id = p_external_id;
    return query select v_conv_id, v_msg_id, true, v_mode;
    return;
  end if;

  update conversations c set
    last_message_at = greatest(coalesce(c.last_message_at, '-infinity'::timestamptz), coalesce(p_created_at, now())),
    last_message_preview = left(coalesce(nullif(p_content, ''), '[' || coalesce(p_type, 'mensagem') || ']'), 160),
    unread_count = c.unread_count + case when v_is_customer then 1 else 0 end,
    -- Cliente voltou a falar numa conversa encerrada: reabre com o bot.
    mode = case when v_is_customer and c.mode = 'closed' then 'bot'::public.conversation_mode else c.mode end
  where c.id = v_conv_id
  returning c.mode into v_mode;

  return query select v_conv_id, v_msg_id, false, v_mode;
end $$;

-- ---------------------------------------------------------------------------
-- Busca híbrida: palavra-chave (tsvector) + semântica (cosseno), fundidas por RRF.
-- SECURITY INVOKER: para usuários autenticados, a RLS de knowledge_chunks continua valendo.
-- ---------------------------------------------------------------------------
create or replace function public.knowledge_search(
  p_workspace_id uuid,
  p_query text,
  p_query_embedding extensions.vector default null,
  p_limit integer default 5
)
returns table (
  chunk_id uuid,
  source_id uuid,
  source_title text,
  source_kind text,
  content text,
  score double precision,
  keyword_rank real,
  similarity double precision
)
language sql stable set search_path = public, extensions as $$
  with q as (
    -- Termos unidos por OR: perguntas de chat raramente contêm todas as palavras do trecho.
    select nullif(string_agg(quote_literal(lexeme), ' | '), '') as expr
    from unnest(tsvector_to_array(to_tsvector('public.pt_unaccent'::regconfig, coalesce(p_query, '')))) as lexeme
  ),
  kw as (
    select c.id, ts_rank_cd(c.tsv, to_tsquery('simple', q.expr)) as rank,
           row_number() over (order by ts_rank_cd(c.tsv, to_tsquery('simple', q.expr)) desc) as pos
    from knowledge_chunks c, q
    where q.expr is not null
      and c.workspace_id = p_workspace_id
      and c.tsv @@ to_tsquery('simple', q.expr)
    order by rank desc
    limit 40
  ),
  sem as (
    select c.id, 1 - (c.embedding <=> p_query_embedding) as sim,
           row_number() over (order by c.embedding <=> p_query_embedding) as pos
    from knowledge_chunks c
    where p_query_embedding is not null
      and c.workspace_id = p_workspace_id
      and c.embedding is not null
    order by c.embedding <=> p_query_embedding
    limit 40
  ),
  fused as (
    select coalesce(kw.id, sem.id) as id,
           coalesce(1.0 / (60 + kw.pos), 0) + coalesce(1.0 / (60 + sem.pos), 0) as score,
           kw.rank, sem.sim
    from kw full outer join sem on sem.id = kw.id
  )
  select c.id, c.source_id, s.title, s.kind, c.content, f.score::double precision, f.rank, f.sim
  from fused f
  join knowledge_chunks c on c.id = f.id
  join knowledge_sources s on s.id = c.source_id
  -- Similaridade baixa sozinha vira ruído no prompt.
  where f.rank is not null or f.sim >= 0.25
  order by f.score desc
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

-- ---------------------------------------------------------------------------
-- Espelhamento de faqs/products em fontes indexáveis (um chunk cada).
-- Embeddings são preenchidos depois pela function knowledge-index (action=embed_pending).
-- ---------------------------------------------------------------------------
create or replace function public.mirror_knowledge_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := case tg_table_name when 'faqs' then 'faq' else 'product' end;
  v_title text;
  v_content text;
  v_source_id uuid;
  v_active boolean;
begin
  if tg_op = 'DELETE' then
    delete from knowledge_sources where workspace_id = old.workspace_id and kind = v_kind and origin_id = old.id;
    return old;
  end if;

  if v_kind = 'faq' then
    v_title := new.question;
    v_content := 'Pergunta: ' || new.question || E'\nResposta: ' || new.answer;
    v_active := new.active;
  else
    v_title := new.name;
    v_content := 'Produto: ' || new.name
      || coalesce(E'\nDescrição: ' || nullif(new.description, ''), '')
      || coalesce(E'\nPreço: ' || new.currency || ' ' || to_char(new.price, 'FM999G999G990D00'), '')
      || coalesce(E'\nLink: ' || nullif(new.url, ''), '');
    v_active := new.active;
  end if;

  if not v_active then
    delete from knowledge_sources where workspace_id = new.workspace_id and kind = v_kind and origin_id = new.id;
    return new;
  end if;

  insert into knowledge_sources (workspace_id, kind, title, origin_id, content, status, chunk_count, embedded, indexed_at)
  values (new.workspace_id, v_kind, v_title, new.id, v_content, 'indexed', 1, false, now())
  on conflict (workspace_id, kind, origin_id) where origin_id is not null do update
    set title = excluded.title, content = excluded.content, status = 'indexed',
        chunk_count = 1, embedded = false, indexed_at = now(), error = null
  returning id into v_source_id;

  delete from knowledge_chunks where source_id = v_source_id;
  insert into knowledge_chunks (workspace_id, source_id, chunk_index, content)
  values (new.workspace_id, v_source_id, 0, v_content);
  return new;
end $$;

create trigger trg_faqs_mirror after insert or update or delete on public.faqs
  for each row execute function public.mirror_knowledge_row();
create trigger trg_products_mirror after insert or update or delete on public.products
  for each row execute function public.mirror_knowledge_row();

-- ---------------------------------------------------------------------------
-- Execução de funções: só o necessário para cada papel.
-- ---------------------------------------------------------------------------
revoke execute on function public.record_message from public, anon, authenticated;
grant execute on function public.record_message to service_role;
revoke execute on function public.mirror_knowledge_row from public, anon, authenticated;
revoke execute on function public.create_workspace, public.list_workspace_members,
  public.add_workspace_member, public.remove_workspace_member from public, anon;
grant execute on function public.create_workspace, public.list_workspace_members,
  public.add_workspace_member, public.remove_workspace_member to authenticated;
revoke execute on function public.knowledge_search from public, anon;
grant execute on function public.knowledge_search to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: documentos da base de conhecimento em <workspace_id>/<arquivo>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge', 'knowledge', false, 20971520)
on conflict (id) do nothing;

create policy knowledge_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'knowledge' and exists (
    select 1 from public.workspace_members m
    where m.user_id = auth.uid() and m.workspace_id::text = (storage.foldername(name))[1]));
create policy knowledge_objects_write on storage.objects for insert to authenticated
  with check (bucket_id = 'knowledge' and exists (
    select 1 from public.workspace_members m
    where m.user_id = auth.uid() and m.role in ('owner', 'admin')
      and m.workspace_id::text = (storage.foldername(name))[1]));
create policy knowledge_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'knowledge' and exists (
    select 1 from public.workspace_members m
    where m.user_id = auth.uid() and m.role in ('owner', 'admin')
      and m.workspace_id::text = (storage.foldername(name))[1]));

-- ---------------------------------------------------------------------------
-- Realtime da inbox
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.conversations, public.messages;
  end if;
end $$;
