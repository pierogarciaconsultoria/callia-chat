-- Painel de atendimentos: indicadores calculados no banco para o período e a instância filtrados.
-- Datas no fuso do workspace (agent_configs.timezone); intervalos [início, fim).

-- Indicadores de um intervalo (usados para o período atual e para o anterior, na comparação).
create or replace function public.dashboard_period_kpis(p_workspace_id uuid, p_start timestamptz, p_end timestamptz, p_instance_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with msgs as (
    select m.* from messages m join conversations c on c.id = m.conversation_id
    where m.workspace_id = p_workspace_id and m.created_at >= p_start and m.created_at < p_end
      and (p_instance_id is null or c.instance_id = p_instance_id)
  ),
  runs as (
    select r.* from agent_runs r join conversations c on c.id = r.conversation_id
    where r.workspace_id = p_workspace_id and r.created_at >= p_start and r.created_at < p_end
      and (p_instance_id is null or c.instance_id = p_instance_id)
  ),
  active as (select distinct conversation_id from msgs where direction = 'inbound' and sender = 'customer'),
  per_conv as (
    select a.conversation_id,
      exists (select 1 from msgs x where x.conversation_id = a.conversation_id and x.sender = 'bot') as has_bot,
      -- Saudação automática do WhatsApp Business (auto_reply) não conta como atendimento da equipe.
      exists (select 1 from msgs x where x.conversation_id = a.conversation_id and x.sender = 'agent'
              and coalesce(x.metadata->>'auto_reply', '') <> 'true') as has_agent,
      exists (select 1 from runs r where r.conversation_id = a.conversation_id and r.status = 'handoff') as ai_handoff
    from active a
  ),
  -- Início de cada "vez" do cliente: mensagem do cliente logo após uma resposta (ou a primeira da conversa).
  ordered as (
    select m.id, m.seq, m.conversation_id, m.created_at, m.direction, m.sender,
      lag(m.direction) over (partition by m.conversation_id order by m.seq) as prev_direction
    from messages m where m.conversation_id in (select conversation_id from active)
  ),
  turns as (
    select o.* from ordered o
    where o.direction = 'inbound' and o.sender = 'customer' and o.created_at >= p_start and o.created_at < p_end
      and (o.prev_direction is null or o.prev_direction = 'outbound')
  ),
  first_reply as (
    select t.created_at as asked_at, r.created_at as replied_at, r.sender
    from turns t
    cross join lateral (
      select x.created_at, x.sender from messages x
      where x.conversation_id = t.conversation_id and x.seq > t.seq and x.direction = 'outbound'
        and coalesce(x.metadata->>'auto_reply', '') <> 'true'
      order by x.seq limit 1
    ) r
  )
  select jsonb_build_object(
    'conversations', (select count(*) from active),
    'new_conversations', (select count(*) from conversations c where c.workspace_id = p_workspace_id
                            and c.created_at >= p_start and c.created_at < p_end
                            and (p_instance_id is null or c.instance_id = p_instance_id)),
    'received', (select count(*) from msgs where direction = 'inbound' and sender = 'customer'),
    'sent_bot', (select count(*) from msgs where sender = 'bot'),
    'sent_agent', (select count(*) from msgs where sender = 'agent' and coalesce(metadata->>'auto_reply', '') <> 'true'),
    'resolved_by_ai', (select count(*) from per_conv where has_bot and not has_agent and not ai_handoff),
    'handed_off_by_ai', (select count(*) from per_conv where ai_handoff),
    'taken_by_team', (select count(*) from per_conv where has_agent and not ai_handoff),
    'unanswered', (select count(*) from per_conv where not has_bot and not has_agent and not ai_handoff),
    'median_first_reply_bot_s', (select round(percentile_cont(0.5) within group (order by extract(epoch from replied_at - asked_at))::numeric)
                                 from first_reply where sender = 'bot'),
    'median_first_reply_team_s', (select round(percentile_cont(0.5) within group (order by extract(epoch from replied_at - asked_at))::numeric)
                                  from first_reply where sender = 'agent'),
    'ai_runs', (select count(*) from runs where status in ('replied', 'handoff', 'failed')),
    'ai_failed', (select count(*) from runs where status = 'failed'),
    'ai_avg_latency_ms', (select round(avg(latency_ms)) from runs where status in ('replied', 'handoff'))
  );
$$;
revoke all on function public.dashboard_period_kpis(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

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
