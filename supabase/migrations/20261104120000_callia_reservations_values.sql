-- Orçamentos x reservas: valores das reservas em R$ (centavos do Hospedin), além das quantidades.

create or replace function public.get_quotes_reservations(
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

  return (
    with quote_runs as (
      select r.conversation_id, r.created_at
      from agent_runs r join conversations c on c.id = r.conversation_id
      where r.workspace_id = p_workspace_id
        and (p_instance_id is null or c.instance_id = p_instance_id)
        and r.usage->'tool_calls' ?| array['calcular_valor', 'consultar_disponibilidade']
    ),
    res as (
      select p.*,
        case
          when p.status in ('reservation', 'check_in', 'cleaning', 'check_out') then 'confirmed'
          when p.status = 'pre_reservation' then 'pre'
          when p.status in ('canceled', 'no_show') then 'canceled'
          else 'other'
        end as status_group,
        case
          when lower(coalesce(p.sale_channel, '')) like '%pr%-reserva%' then 'pre_reservation_form'
          when lower(coalesce(p.sale_channel, '')) in ('site', 'hbook') then 'site'
          when lower(coalesce(p.sale_channel, '')) like 'balc%' then 'front_desk'
          when lower(coalesce(p.sale_channel, '')) ~ '(booking|airbnb|hotels|expedia|decolar|trivago)' then 'ota'
          else 'other'
        end as channel,
        exists (
          select 1 from conversations c
          join quote_runs q on q.conversation_id = c.id
          where c.workspace_id = p_workspace_id
            and public.phone_key(c.contact_phone) = public.phone_key(p.guest_phone)
            and q.created_at <= p.first_seen_at and q.created_at > p.first_seen_at - interval '30 days'
        ) as from_quote
      from pms_reservations p
      where p.workspace_id = p_workspace_id and not p.baseline
        and p.first_seen_at >= v_start and p.first_seen_at < v_end
        and p.status <> 'blocked'
    ),
    counted as (select * from res where status_group in ('confirmed', 'pre'))
    select jsonb_build_object(
      'pms_connected', exists (select 1 from workspace_connectors w where w.workspace_id = p_workspace_id and w.kind = 'hospedin' and w.enabled and w.status = 'connected'),
      'tracking_since', (select min(first_seen_at) from pms_reservations where workspace_id = p_workspace_id),
      'quotes', (select count(*) from quote_runs where created_at >= v_start and created_at < v_end),
      'quoted_conversations', (select count(distinct conversation_id) from quote_runs where created_at >= v_start and created_at < v_end),
      'reservations', (select count(*) from counted),
      'confirmed', (select count(*) from res where status_group = 'confirmed'),
      'pre_reservations', (select count(*) from res where status_group = 'pre'),
      'canceled', (select count(*) from res where status_group = 'canceled'),
      'from_quote', (select count(*) from counted where from_quote),
      'from_quote_total_cents', (select coalesce(sum(total_cents), 0) from counted where from_quote),
      'by_channel', (select coalesce(jsonb_object_agg(channel, n), '{}'::jsonb) from (select channel, count(*) as n from counted group by channel) s),
      -- Valores em centavos (o Hospedin informa total_daily_cents): R$ = centavos / 100.
      'reservations_total_cents', (select coalesce(sum(total_cents), 0) from counted),
      'confirmed_total_cents', (select coalesce(sum(total_cents), 0) from res where status_group = 'confirmed'),
      'pre_total_cents', (select coalesce(sum(total_cents), 0) from res where status_group = 'pre'),
      'canceled_total_cents', (select coalesce(sum(total_cents), 0) from res where status_group = 'canceled'),
      'by_channel_cents', (select coalesce(jsonb_object_agg(channel, c), '{}'::jsonb) from (select channel, coalesce(sum(total_cents), 0) as c from counted group by channel) s)
    )
  );
end;
$$;
revoke all on function public.get_quotes_reservations(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.get_quotes_reservations(uuid, date, date, uuid, text) to authenticated, service_role;
