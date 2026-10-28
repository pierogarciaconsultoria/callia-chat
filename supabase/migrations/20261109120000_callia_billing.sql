-- Cobrança: assinatura mensal no Mercado Pago (preapproval). Cada plano do Callia aponta para um plano de assinatura
-- do Mercado Pago; cada workspace tem a sua assinatura. O status do tenant muda só pela RPC (service_role), a partir
-- do que o Mercado Pago confirma — nunca pelo cliente.

alter table public.plans add column if not exists mp_preapproval_plan_id text;

create table public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'mercadopago' check (provider in ('mercadopago')),
  provider_subscription_id text not null,
  plan_id uuid references public.plans(id),
  status text not null check (status in ('pending', 'authorized', 'paused', 'cancelled')),
  payer_email text,
  init_point text,
  next_payment_at timestamptz,
  last_payment_at timestamptz,
  last_event_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create index workspace_subscriptions_workspace_idx on public.workspace_subscriptions(workspace_id, created_at desc);
alter table public.workspace_subscriptions enable row level security;
create policy workspace_subscriptions_select on public.workspace_subscriptions for select to authenticated
  using (public.is_workspace_admin(workspace_id));
grant select on public.workspace_subscriptions to authenticated;
grant all on public.workspace_subscriptions to service_role;
create trigger trg_workspace_subscriptions_touch before update on public.workspace_subscriptions
  for each row execute function public.touch_updated_at();

-- Aplica ao tenant o estado confirmado da assinatura. Idempotente (o Mercado Pago reenvia notificações).
-- authorized → ativo no plano; cancelled/paused → suspenso, só se o tenant estava ativo por esta assinatura.
create or replace function public.apply_subscription_status(
  p_workspace_id uuid,
  p_provider_subscription_id text,
  p_plan_id uuid,
  p_status text,
  p_payer_email text default null,
  p_init_point text default null,
  p_next_payment_at timestamptz default null,
  p_last_payment_at timestamptz default null,
  p_raw jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_before text;
  v_after text;
  v_id uuid;
begin
  if p_status not in ('pending', 'authorized', 'paused', 'cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select status into v_prev from workspace_subscriptions
    where provider = 'mercadopago' and provider_subscription_id = p_provider_subscription_id;
  select status::text into v_before from workspaces where id = p_workspace_id;
  if v_before is null then
    raise exception 'workspace_not_found' using errcode = 'P0002';
  end if;

  insert into workspace_subscriptions (workspace_id, provider_subscription_id, plan_id, status, payer_email, init_point,
                                       next_payment_at, last_payment_at, last_event_at, raw)
  values (p_workspace_id, p_provider_subscription_id, p_plan_id, p_status, p_payer_email, p_init_point,
          p_next_payment_at, p_last_payment_at, now(), coalesce(p_raw, '{}'::jsonb))
  on conflict (provider, provider_subscription_id) do update set
    status = excluded.status,
    plan_id = coalesce(excluded.plan_id, workspace_subscriptions.plan_id),
    payer_email = coalesce(excluded.payer_email, workspace_subscriptions.payer_email),
    init_point = coalesce(excluded.init_point, workspace_subscriptions.init_point),
    next_payment_at = coalesce(excluded.next_payment_at, workspace_subscriptions.next_payment_at),
    last_payment_at = coalesce(excluded.last_payment_at, workspace_subscriptions.last_payment_at),
    last_event_at = now(),
    raw = excluded.raw
  returning id into v_id;

  if p_status = 'authorized' then
    update workspaces set status = 'active', plan_id = coalesce(p_plan_id, plan_id), trial_ends_at = null,
      suspended_at = null, suspended_reason = null
      where id = p_workspace_id;
  elsif p_status in ('cancelled', 'paused') and v_prev = 'authorized' and v_before = 'active' then
    update workspaces set status = 'suspended', suspended_at = now(),
      suspended_reason = case p_status when 'paused' then 'Assinatura pausada no Mercado Pago.' else 'Assinatura cancelada no Mercado Pago.' end
      where id = p_workspace_id;
  end if;
  select status::text into v_after from workspaces where id = p_workspace_id;
  return jsonb_build_object('subscription_id', v_id, 'previous_subscription_status', v_prev,
                            'workspace_status_before', v_before, 'workspace_status_after', v_after);
end $$;
revoke execute on function public.apply_subscription_status(uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_subscription_status(uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb) to service_role;
