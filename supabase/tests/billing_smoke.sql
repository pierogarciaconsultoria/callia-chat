-- Cobrança: a RPC aplica o estado da assinatura ao tenant; cliente só lê a própria assinatura. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('dddddddd-0000-0000-0000-000000000001', 'dona@assina.com', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000002', 'outra@loja.com', 'authenticated', 'authenticated');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
update public.plans set mp_preapproval_plan_id = 'mp-plan-essencial' where code = 'essencial';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Assina')::text, true);
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.ws_b', public.create_workspace('Loja Outra')::text, true);

-- 1. Cliente não executa a RPC.
do $$ begin
  perform public.apply_subscription_status(current_setting('test.ws')::uuid, 'sub-1', null, 'authorized');
  raise exception 'authenticated não deveria aplicar assinatura';
exception when insufficient_privilege then null;
end $$;

-- 2. Serviço: pendente não muda o tenant; autorizada ativa no plano; cancelada suspende; reenvio é idempotente.
reset role;
select set_config('test.plan', (select id::text from public.plans where code = 'essencial'), true);
do $$
declare ws uuid := current_setting('test.ws')::uuid; plan uuid := current_setting('test.plan')::uuid; r jsonb;
begin
  r := public.apply_subscription_status(ws, 'sub-1', plan, 'pending', 'dona@assina.com', 'https://mp/init');
  assert r->>'workspace_status_after' = 'trial', 'pendente não ativa: ' || r::text;
  r := public.apply_subscription_status(ws, 'sub-1', plan, 'authorized', null, null, '2026-11-28T00:00:00Z');
  assert r->>'workspace_status_before' = 'trial' and r->>'workspace_status_after' = 'active', 'autorizada ativa: ' || r::text;
  assert (select plan_id from public.workspaces where id = ws) = plan and (select trial_ends_at from public.workspaces where id = ws) is null, 'plano aplicado e trial encerrado';
  assert (select init_point from public.workspace_subscriptions where provider_subscription_id = 'sub-1') = 'https://mp/init', 'init_point preservado';
  r := public.apply_subscription_status(ws, 'sub-1', plan, 'authorized', null, null, '2026-12-28T00:00:00Z', '2026-11-28T10:00:00Z');
  assert r->>'workspace_status_after' = 'active' and (select count(*) from public.workspace_subscriptions where workspace_id = ws) = 1, 'reenvio idempotente';
  r := public.apply_subscription_status(ws, 'sub-1', plan, 'cancelled');
  assert r->>'workspace_status_after' = 'suspended', 'cancelada suspende: ' || r::text;
  assert (select suspended_reason from public.workspaces where id = ws) like 'Assinatura cancelada%', 'motivo da suspensão';
  r := public.apply_subscription_status(ws, 'sub-1', plan, 'cancelled');
  assert r->>'workspace_status_after' = 'suspended', 'cancelamento repetido não muda nada';
end $$;

-- 3. Cancelar uma assinatura que nunca foi autorizada não suspende (tenant em trial segue em trial).
do $$
declare ws uuid := current_setting('test.ws_b')::uuid; r jsonb;
begin
  r := public.apply_subscription_status(ws, 'sub-b', null, 'pending');
  r := public.apply_subscription_status(ws, 'sub-b', null, 'cancelled');
  assert r->>'workspace_status_after' = 'trial', 'desistiu antes de pagar: ' || r::text;
end $$;
do $$ begin
  perform public.apply_subscription_status(current_setting('test.ws')::uuid, 'sub-x', null, 'weird');
  raise exception 'status inválido deveria falhar';
exception when invalid_parameter_value then null;
end $$;

-- 4. Dona lê a própria assinatura; outro workspace não vê.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.workspace_subscriptions) = 1, 'dona vê só a própria assinatura';
end $$;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.workspace_subscriptions where provider_subscription_id = 'sub-1') = 0, 'assinatura não vaza entre workspaces';
end $$;

rollback;
