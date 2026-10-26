-- Camada SaaS: planos, limites, ciclo de vida do tenant e administração central da plataforma.
-- Administradores da plataforma = user_roles.role 'platform_admin'. O console central usa a function
-- platform-admin (service_role); tenants só enxergam o próprio plano, uso e status.

create type public.tenant_status as enum ('trial', 'active', 'suspended', 'canceled');

-- ---------------------------------------------------------------------------
-- Planos (limite nulo = ilimitado)
-- ---------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,40}$'),
  name text not null,
  description text,
  price_cents integer check (price_cents is null or price_cents >= 0),
  currency text not null default 'BRL',
  max_instances integer check (max_instances is null or max_instances >= 0),
  max_members integer check (max_members is null or max_members >= 1),
  max_monthly_messages integer check (max_monthly_messages is null or max_monthly_messages >= 0),
  max_knowledge_sources integer check (max_knowledge_sources is null or max_knowledge_sources >= 0),
  ai_enabled boolean not null default true,
  external_agent_enabled boolean not null default true,
  connectors_enabled boolean not null default true,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_plans_touch before update on public.plans for each row execute function public.touch_updated_at();

alter table public.workspaces
  add column status public.tenant_status not null default 'active',
  add column plan_id uuid references public.plans(id) on delete set null,
  add column trial_ends_at timestamptz,
  add column suspended_at timestamptz,
  add column suspended_reason text,
  -- Sobrescreve limites do plano para este cliente: {"max_instances": 5, "ai_enabled": false, ...}
  add column limit_overrides jsonb not null default '{}'::jsonb,
  add column notes text;
create index workspaces_status_idx on public.workspaces(status);

-- Acesso de suporte: admin da plataforma entra num tenant de forma explícita e auditada.
alter table public.workspace_members add column is_support boolean not null default false;

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.plans (code, name, description, max_instances, max_members, max_monthly_messages, max_knowledge_sources, position)
values
  ('trial', 'Avaliação', 'Período de teste com limites reduzidos.', 1, 3, 500, 20, 0),
  ('essencial', 'Essencial', 'Um número de WhatsApp e equipe pequena.', 1, 5, 3000, 100, 1),
  ('profissional', 'Profissional', 'Vários números, equipe maior e integrações.', 3, 15, 15000, 500, 2)
on conflict (code) do nothing;

insert into public.platform_settings (key, value) values
  ('allow_self_service_workspaces', 'false'::jsonb),
  ('self_service_plan_code', '"trial"'::jsonb),
  ('trial_days', '14'::jsonb),
  ('platform_name', '"Callia Chat"'::jsonb),
  ('support_email', 'null'::jsonb)
on conflict (key) do nothing;

-- Workspaces existentes continuam sem plano (= ilimitado) e ativos.

-- ---------------------------------------------------------------------------
-- RLS e privilégios
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.platform_settings enable row level security;
revoke all on public.plans, public.platform_settings from anon;

create policy plans_read on public.plans for select to authenticated using (true);
create policy settings_read on public.platform_settings for select to authenticated using (true);

-- Tenant edita só o nome; status, plano, trial e limites são da plataforma.
revoke update on public.workspaces from authenticated;
grant update (name) on public.workspaces to authenticated;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_app_role('platform_admin');
$$;

-- ---------------------------------------------------------------------------
-- Uso e direitos efetivos do tenant
-- ---------------------------------------------------------------------------
create or replace function public.workspace_usage(p_workspace_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'period_start', date_trunc('month', now()),
    -- Mensagens automáticas (bot e API) contam para a cota; respostas da equipe não.
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
      where workspace_id = p_workspace_id and kind in ('text', 'url', 'document'))
  );
$$;

create or replace function public.get_workspace_entitlements(p_workspace_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  w workspaces;
  p plans;
  v_effective text;
  v_limits jsonb;
begin
  -- service_role (auth.uid() nulo) lê qualquer tenant; usuários só os seus, ou todos se forem da plataforma.
  if auth.uid() is not null and not public.is_workspace_member(p_workspace_id) and not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into w from workspaces where id = p_workspace_id;
  if not found then
    raise exception 'workspace_not_found' using errcode = 'P0002';
  end if;
  if w.plan_id is not null then
    select * into p from plans where id = w.plan_id;
  end if;

  v_effective := case
    when w.status = 'trial' and w.trial_ends_at is not null and w.trial_ends_at < now() then 'trial_expired'
    else w.status::text
  end;

  v_limits := jsonb_build_object(
    'max_instances', p.max_instances,
    'max_members', p.max_members,
    'max_monthly_messages', p.max_monthly_messages,
    'max_knowledge_sources', p.max_knowledge_sources,
    'ai_enabled', coalesce(p.ai_enabled, true),
    'external_agent_enabled', coalesce(p.external_agent_enabled, true),
    'connectors_enabled', coalesce(p.connectors_enabled, true)
  ) || coalesce(w.limit_overrides, '{}'::jsonb);

  return jsonb_build_object(
    'workspace_id', w.id,
    'status', w.status,
    'effective_status', v_effective,
    'active', v_effective in ('trial', 'active'),
    'trial_ends_at', w.trial_ends_at,
    'suspended_reason', w.suspended_reason,
    'plan', case when p.id is null then null else jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) end,
    'limits', v_limits,
    'usage', public.workspace_usage(w.id)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Provisionamento de tenants
-- ---------------------------------------------------------------------------
create or replace function public.provision_workspace(
  p_name text,
  p_owner uuid,
  p_plan_id uuid,
  p_status public.tenant_status,
  p_trial_ends_at timestamptz,
  p_actor uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_slug text;
begin
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  v_slug := trim(both '-' from regexp_replace(lower(extensions.unaccent(p_name)), '[^a-z0-9]+', '-', 'g'));
  v_slug := coalesce(nullif(v_slug, ''), 'workspace') || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

  insert into workspaces(name, slug, created_by, plan_id, status, trial_ends_at)
  values (trim(p_name), v_slug, coalesce(p_actor, p_owner), p_plan_id, p_status, p_trial_ends_at)
  returning id into v_id;
  insert into workspace_members(workspace_id, user_id, role) values (v_id, p_owner, 'owner');
  insert into workspace_branding(workspace_id, display_name) values (v_id, trim(p_name));
  insert into agent_configs(workspace_id) values (v_id);
  insert into audit_logs(workspace_id, actor_user_id, action, entity, entity_id, details)
    values (v_id, coalesce(p_actor, p_owner), 'workspace.created', 'workspace', v_id::text,
            jsonb_build_object('owner', p_owner, 'plan_id', p_plan_id, 'status', p_status));
  return v_id;
end $$;

-- Autoatendimento: só quando a plataforma permite (ou para admins da plataforma).
create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_self_service boolean;
  v_plan_id uuid;
  v_trial_days integer;
  v_admin boolean := public.is_platform_admin();
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select coalesce((value)::text::boolean, false) into v_self_service from platform_settings where key = 'allow_self_service_workspaces';
  if not v_admin and not coalesce(v_self_service, false) then
    raise exception 'self_service_disabled' using errcode = '42501';
  end if;
  if v_admin then
    return public.provision_workspace(p_name, auth.uid(), null, 'active', null, auth.uid());
  end if;
  select p.id into v_plan_id from plans p
    where p.code = (select value #>> '{}' from platform_settings where key = 'self_service_plan_code') and p.active;
  select coalesce((value #>> '{}')::integer, 14) into v_trial_days from platform_settings where key = 'trial_days';
  return public.provision_workspace(p_name, auth.uid(), v_plan_id, 'trial', now() + make_interval(days => coalesce(v_trial_days, 14)), auth.uid());
end $$;

-- Equipe: respeita o limite de membros do plano e o status do tenant.
create or replace function public.add_workspace_member(p_workspace_id uuid, p_email text, p_role public.workspace_role)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_caller_role public.workspace_role;
  v_ent jsonb;
  v_max integer;
begin
  select role into v_caller_role from workspace_members where workspace_id = p_workspace_id and user_id = auth.uid();
  if v_caller_role is null or v_caller_role = 'agent' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'only_owner_can_grant_owner' using errcode = '42501';
  end if;
  v_ent := public.get_workspace_entitlements(p_workspace_id);
  if not (v_ent->>'active')::boolean then
    raise exception 'tenant_inactive' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  v_max := (v_ent #>> '{limits,max_members}')::integer;
  if v_max is not null
     and not exists (select 1 from workspace_members where workspace_id = p_workspace_id and user_id = v_user)
     and (v_ent #>> '{usage,members}')::integer >= v_max then
    raise exception 'member_limit_reached' using errcode = '54000';
  end if;
  insert into workspace_members(workspace_id, user_id, role) values (p_workspace_id, v_user, p_role)
    on conflict (workspace_id, user_id) do update set role = excluded.role, is_support = false;
  insert into audit_logs(workspace_id, actor_user_id, action, entity, entity_id, details)
    values (p_workspace_id, auth.uid(), 'member.upserted', 'user', v_user::text, jsonb_build_object('role', p_role));
  return v_user;
end $$;

drop function public.list_workspace_members(uuid);
create function public.list_workspace_members(p_workspace_id uuid)
returns table (user_id uuid, email text, role public.workspace_role, is_support boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.is_support, m.created_at
  from workspace_members m join auth.users u on u.id = m.user_id
  where m.workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
  order by m.is_support, m.created_at;
$$;

revoke execute on function public.provision_workspace, public.workspace_usage from public, anon, authenticated;
grant execute on function public.provision_workspace, public.workspace_usage to service_role;
revoke execute on function public.get_workspace_entitlements, public.is_platform_admin, public.list_workspace_members from public, anon;
grant execute on function public.get_workspace_entitlements, public.is_platform_admin, public.list_workspace_members to authenticated, service_role;

-- Lista consolidada para o console da plataforma (service_role).
create or replace function public.platform_list_tenants()
returns table (
  id uuid, name text, slug text, status public.tenant_status, effective_status text, plan_id uuid, plan_code text, plan_name text,
  trial_ends_at timestamptz, suspended_reason text, limit_overrides jsonb, notes text, created_at timestamptz,
  owner_email text, instances_open integer, last_message_at timestamptz, usage jsonb
)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, w.slug, w.status,
         case when w.status = 'trial' and w.trial_ends_at < now() then 'trial_expired' else w.status::text end,
         w.plan_id, p.code, p.name, w.trial_ends_at, w.suspended_reason, w.limit_overrides, w.notes, w.created_at,
         (select u.email::text from workspace_members m join auth.users u on u.id = m.user_id
           where m.workspace_id = w.id and m.role = 'owner' and not m.is_support order by m.created_at limit 1),
         (select count(*)::int from whatsapp_instances i where i.workspace_id = w.id and i.status = 'open'),
         (select max(c.last_message_at) from conversations c where c.workspace_id = w.id),
         public.workspace_usage(w.id)
  from workspaces w left join plans p on p.id = w.plan_id
  order by w.created_at desc;
$$;
revoke execute on function public.platform_list_tenants from public, anon, authenticated;
grant execute on function public.platform_list_tenants to service_role;

create or replace function public.platform_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

create or replace function public.platform_list_users(p_search text default null)
returns table (
  id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, invited_at timestamptz,
  confirmed boolean, blocked boolean, platform_admin boolean, workspaces jsonb
)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.invited_at,
         (u.email_confirmed_at is not null or u.last_sign_in_at is not null),
         (u.banned_until is not null and u.banned_until > now()),
         exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'platform_admin'),
         coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'role', m.role, 'is_support', m.is_support) order by w.name)
                   from workspace_members m join workspaces w on w.id = m.workspace_id where m.user_id = u.id), '[]'::jsonb)
  from auth.users u
  where p_search is null or p_search = '' or u.email ilike '%' || p_search || '%'
  order by u.created_at desc
  limit 500;
$$;

create or replace function public.platform_audit(p_workspace_id uuid default null, p_action_prefix text default null, p_limit integer default 100)
returns table (
  id uuid, workspace_id uuid, workspace_name text, actor_user_id uuid, actor_email text, actor_type text,
  action text, entity text, entity_id text, details jsonb, correlation_id text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select a.id, a.workspace_id, w.name, a.actor_user_id, u.email::text, a.actor_type, a.action, a.entity, a.entity_id,
         a.details, a.correlation_id, a.created_at
  from audit_logs a
  left join workspaces w on w.id = a.workspace_id
  left join auth.users u on u.id = a.actor_user_id
  where (p_workspace_id is null or a.workspace_id = p_workspace_id)
    and (p_action_prefix is null or p_action_prefix = '' or a.action like p_action_prefix || '%')
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke execute on function public.platform_user_id_by_email, public.platform_list_users, public.platform_audit from public, anon, authenticated;
grant execute on function public.platform_user_id_by_email, public.platform_list_users, public.platform_audit to service_role;
