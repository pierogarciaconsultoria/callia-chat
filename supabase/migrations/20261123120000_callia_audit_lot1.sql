-- Auditoria SaaS 2026-11-14, lote 1: visibilidade por atendente no dashboard, em "assumir" e nos anexos recebidos;
-- user_label e sticky_enabled só para quem compartilha workspace; QR de pareamento fora do grant de colunas;
-- privilégio residual de anon removido das tabelas novas e dos padrões do schema.

-- A-02: get_dashboard — bloco 'waiting' filtrado por can_view_conversation (função reescrita na íntegra).
create or replace function public.get_dashboard(
  p_workspace_id uuid,
  p_from date,
  p_to date,
  p_instance_id uuid default null,
  p_tz text default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_hourly boolean;
begin
  if auth.uid() is not null and not public.is_workspace_member(p_workspace_id) and not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  select coalesce(p_tz, (select timezone from agent_configs where workspace_id = p_workspace_id), 'America/Sao_Paulo') into v_tz;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := 'America/Sao_Paulo'; end if;

  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_start := v_start - (v_end - v_start);
  v_hourly := p_from = p_to;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz, 'bucket', case when v_hourly then 'hour' else 'day' end),
    'current', public.dashboard_period_kpis(p_workspace_id, v_start, v_end, p_instance_id),
    'previous', public.dashboard_period_kpis(p_workspace_id, v_prev_start, v_start, p_instance_id),

    -- Mensagens por dia (ou por hora, quando o período é um dia só), com zeros preenchidos.
    'series', (
      with buckets as (
        select b as bucket from generate_series(
          p_from::timestamp,
          case when v_hourly then p_from::timestamp + interval '23 hours' else p_to::timestamp end,
          case when v_hourly then interval '1 hour' else interval '1 day' end) b
      ),
      msgs as (
        select date_trunc(case when v_hourly then 'hour' else 'day' end, m.created_at at time zone v_tz) as bucket, m.direction, m.sender, m.metadata
        from messages m join conversations c on c.id = m.conversation_id
        where m.workspace_id = p_workspace_id and m.created_at >= v_start and m.created_at < v_end
          and (p_instance_id is null or c.instance_id = p_instance_id)
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        't', to_char(b.bucket, case when v_hourly then 'YYYY-MM-DD"T"HH24:MI' else 'YYYY-MM-DD' end),
        'received', (select count(*) from msgs m where m.bucket = b.bucket and m.direction = 'inbound' and m.sender = 'customer'),
        'bot', (select count(*) from msgs m where m.bucket = b.bucket and m.sender = 'bot'),
        'agent', (select count(*) from msgs m where m.bucket = b.bucket and m.sender = 'agent' and coalesce(m.metadata->>'auto_reply', '') <> 'true')
      ) order by b.bucket), '[]'::jsonb)
      from buckets b
    ),

    -- Mensagens recebidas por hora do dia (horário de pico).
    'by_hour', (
      select jsonb_agg(jsonb_build_object('hour', h, 'received', coalesce(n, 0)) order by h)
      from generate_series(0, 23) h
      left join (
        select extract(hour from m.created_at at time zone v_tz)::int as hr, count(*) as n
        from messages m join conversations c on c.id = m.conversation_id
        where m.workspace_id = p_workspace_id and m.created_at >= v_start and m.created_at < v_end
          and m.direction = 'inbound' and m.sender = 'customer'
          and (p_instance_id is null or c.instance_id = p_instance_id)
        group by 1
      ) x on x.hr = h
    ),

    -- O que a IA fez: respostas que usaram cada ferramenta.
    'tools', (
      select coalesce(jsonb_object_agg(tool, n), '{}'::jsonb) from (
        select t.tool, count(distinct r.id) as n
        from agent_runs r join conversations c on c.id = r.conversation_id
        cross join lateral jsonb_array_elements_text(coalesce(r.usage->'tool_calls', '[]'::jsonb)) as t(tool)
        where r.workspace_id = p_workspace_id and r.created_at >= v_start and r.created_at < v_end
          and (p_instance_id is null or c.instance_id = p_instance_id)
        group by t.tool
      ) s
    ),

    -- Por que a IA transferiu para a equipe.
    'handoff_reasons', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select case
            when r.reason like 'keyword:%' then 'keyword'
            when r.reason like 'tool:%' then 'ai_decision'
            when r.reason = 'no_answer' then 'no_answer'
            when r.reason = 'external_agent' then 'external_agent'
            else 'other' end as kind,
          count(*) as n
        from agent_runs r join conversations c on c.id = r.conversation_id
        where r.workspace_id = p_workspace_id and r.status = 'handoff' and r.created_at >= v_start and r.created_at < v_end
          and (p_instance_id is null or c.instance_id = p_instance_id)
        group by 1
      ) s
    ),

    -- Agora (independe do período): conversas abertas cuja última mensagem é do cliente.
    'waiting', (
      select coalesce(jsonb_agg(w order by w->>'since'), '[]'::jsonb) from (
        select jsonb_build_object(
          'conversation_id', c.id, 'contact_name', c.contact_name, 'contact_phone', c.contact_phone,
          'mode', c.mode, 'since', lm.created_at, 'preview', left(lm.content, 120)) as w
        from conversations c
        cross join lateral (
          select m.direction, m.sender, m.created_at, m.content from messages m
          where m.conversation_id = c.id order by m.seq desc limit 1
        ) lm
        where c.workspace_id = p_workspace_id and c.mode <> 'closed'
          and (p_instance_id is null or c.instance_id = p_instance_id)
          -- Auditoria 2026-11-14 (A-02): a fila "aguardando" respeita a visibilidade por atendente (agent_visibility = 'own').
          and (auth.uid() is null or public.is_platform_admin() or public.can_view_conversation(c.workspace_id, c.assigned_user_id, c.department_id))
          and lm.direction = 'inbound' and lm.sender = 'customer'
          and lm.created_at < now() - interval '2 minutes'
        order by lm.created_at
        limit 20
      ) s
    )
  );
end;
$$;
revoke all on function public.get_dashboard(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.get_dashboard(uuid, date, date, uuid, text) to authenticated, service_role;

-- M-03: assumir pela inbox exige poder ver a conversa (não só ser membro).
create or replace function public.claim_conversation(p_conversation_id uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_assigned uuid;
  v_dept uuid;
  v_mode text;
begin
  select workspace_id, assigned_user_id, department_id, mode into v_ws, v_assigned, v_dept, v_mode from conversations where id = p_conversation_id;
  if v_ws is null or not public.can_view_conversation(v_ws, v_assigned, v_dept) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_mode = 'human' and v_assigned is not null and v_assigned <> auth.uid() and not p_force then
    return jsonb_build_object('claimed', false, 'conflict', true, 'assigned_user_id', v_assigned);
  end if;
  update conversations set mode = 'human', assigned_user_id = auth.uid(), handoff_at = now() where id = p_conversation_id;
  if public.sticky_enabled(v_ws) then
    perform public.link_contact_operator(p_conversation_id, auth.uid());
  end if;
  insert into audit_logs (workspace_id, actor_user_id, action, entity, entity_id, details)
    values (v_ws, auth.uid(), 'conversation.claimed', 'conversation', p_conversation_id::text,
            jsonb_build_object('force', p_force, 'previous_assigned_user_id', v_assigned));
  return jsonb_build_object('claimed', true, 'conflict', false, 'assigned_user_id', auth.uid());
end $$;

-- M-03: "Ficar com este cliente" exige ver a conversa e, se o número já é de outro atendente, ser admin.
create or replace function public.claim_contact(p_conversation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_assigned uuid;
  v_dept uuid;
  v_phone text;
  v_owner uuid;
begin
  select workspace_id, assigned_user_id, department_id, regexp_replace(contact_phone, '[^0-9]', '', 'g')
    into v_ws, v_assigned, v_dept, v_phone from conversations where id = p_conversation_id;
  if v_ws is null or not public.can_view_conversation(v_ws, v_assigned, v_dept) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select user_id into v_owner from contact_assignments where workspace_id = v_ws and phone = v_phone;
  if v_owner is not null and v_owner <> auth.uid() and not public.is_workspace_admin(v_ws) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into contact_assignments (workspace_id, phone, user_id, created_by) values (v_ws, v_phone, auth.uid(), auth.uid())
    on conflict (workspace_id, phone) do update set user_id = excluded.user_id, created_by = excluded.created_by, created_at = now();
  update conversations set assigned_user_id = auth.uid() where id = p_conversation_id and mode = 'human';
end $$;

-- M-04: anexos recebidos (<workspace>/<conversa>/...) só para quem pode ver a conversa; outbound continua por membro.
drop policy if exists inbox_media_objects_read on storage.objects;
create policy inbox_media_objects_read on storage.objects for select to authenticated
  using (
    bucket_id = 'inbox-media'
    and exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid() and m.workspace_id::text = (storage.foldername(name))[1])
    and (
      (storage.foldername(name))[2] = 'outbound'
      or exists (
        select 1 from public.conversations c
        where c.id::text = (storage.foldername(name))[2]
          and c.workspace_id::text = (storage.foldername(name))[1]
          and public.can_view_conversation(c.workspace_id, c.assigned_user_id, c.department_id))
    )
  );

-- M-05: user_label só resolve quem compartilha um workspace com o chamador (service_role continua livre).
create or replace function public.user_label(p_user_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ''),
    split_part(u.email, '@', 1)
  ) from auth.users u
  where u.id = p_user_id
    and (
      auth.uid() is null
      or p_user_id = auth.uid()
      or exists (
        select 1 from public.workspace_members a join public.workspace_members b on b.workspace_id = a.workspace_id
        where a.user_id = auth.uid() and b.user_id = p_user_id)
    )
$$;

create or replace function public.sticky_enabled(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or public.is_workspace_member(p_workspace_id)
      then coalesce((select sticky_claim from workspace_routing where workspace_id = p_workspace_id), true)
    else null
  end
$$;

-- M-06: o QR de pareamento sai do grant de colunas; o painel o recebe pela function evolution-connect (admin).
revoke select on public.whatsapp_instances from authenticated;
grant select (id, workspace_id, name, instance_name, provider, status, qr_updated_at, phone_number,
  profile_name, is_default, last_connected_at, last_error, webhook_token_rotated_at, created_at, updated_at)
  on public.whatsapp_instances to authenticated;

-- B-03: privilégio residual de anon nas tabelas criadas depois da fundação e nos padrões do schema.
revoke all on public.workspace_policies, public.workspace_subscriptions, public.assistant_proposals from anon;
do $$
declare r text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter default privileges for role %I in schema public revoke all on tables from anon', r);
      execute format('alter default privileges for role %I in schema public revoke all on sequences from anon', r);
    end if;
  end loop;
end $$;
