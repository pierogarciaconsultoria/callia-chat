-- Reservas do PMS (Hospedin) sincronizadas a cada 15 min, para medir orçamentos da IA x reservas efetuadas.
-- first_seen_at = quando o Callia viu a reserva pela primeira vez (a API não informa a data de criação).
-- baseline = já existia na primeira sincronização (não conta como reserva nova).

create table public.pms_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('hospedin')),
  external_id bigint not null,
  code text,
  status text not null,
  sale_channel text,
  check_in date,
  check_out date,
  place_type_id bigint,
  total_cents bigint,
  adults int,
  children int,
  -- Telefone do hóspede (só dígitos, com DDI), para cruzar com a conversa do WhatsApp.
  guest_phone text,
  baseline boolean not null default false,
  first_seen_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);
create index pms_reservations_seen on public.pms_reservations (workspace_id, first_seen_at) where not baseline;

alter table public.pms_reservations enable row level security;
revoke all on public.pms_reservations from anon;
create policy pms_reservations_select on public.pms_reservations for select to authenticated
  using (public.is_workspace_member(workspace_id));
-- Gravação só pela sincronização (service_role).
revoke insert, update, delete on public.pms_reservations from authenticated;

-- Chave de telefone para casar WhatsApp x cadastro do hóspede.
-- Brasil: DDD + 8 últimos dígitos (o WhatsApp às vezes omite o 9º dígito do celular). Outros países: 9 últimos.
create or replace function public.phone_key(p_phone text) returns text language sql immutable as $$
  select case
    when d is null or length(d) < 8 then null
    when d like '55%' and length(d) in (12, 13) then 'br:' || substr(d, 3, 2) || right(d, 8)
    when length(d) in (10, 11) then 'br:' || left(d, 2) || right(d, 8)
    else 'x:' || right(d, 9)
  end
  from (select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') as d) s;
$$;

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
      'by_channel', (select coalesce(jsonb_object_agg(channel, n), '{}'::jsonb) from (select channel, count(*) as n from counted group by channel) s)
    )
  );
end;
$$;
revoke all on function public.get_quotes_reservations(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.get_quotes_reservations(uuid, date, date, uuid, text) to authenticated, service_role;
