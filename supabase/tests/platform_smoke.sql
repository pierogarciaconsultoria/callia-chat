-- Teste da camada SaaS: planos, limites, status do tenant e permissões da plataforma. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'root@plataforma.com', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dono@cliente.com', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'm1@cliente.com', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'm2@cliente.com', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'm3@cliente.com', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'outro@x.com', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000001', 'platform_admin');

set local role authenticated;
-- 1. Sem autoatendimento, usuário comum não cria workspace.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  perform public.create_workspace('Pousada Teste');
  raise exception 'deveria bloquear criação sem autoatendimento';
exception when insufficient_privilege then null;
end $$;

-- 2. Admin da plataforma cria (ativo, sem plano = ilimitado).
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ws_admin', public.create_workspace('Interno')::text, true);
do $$
declare e jsonb := public.get_workspace_entitlements(current_setting('test.ws_admin')::uuid);
begin
  assert e->>'status' = 'active' and e->'plan' = 'null'::jsonb and (e->>'active')::boolean, 'workspace do admin: ' || e::text;
  assert e #>> '{limits,max_instances}' is null, 'sem plano deveria ser ilimitado';
end $$;

-- 3. Com autoatendimento, cliente cria em trial no plano de avaliação.
reset role;
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Teste')::text, true);
do $$
declare e jsonb := public.get_workspace_entitlements(current_setting('test.ws')::uuid);
begin
  assert e->>'status' = 'trial' and e #>> '{plan,code}' = 'trial', 'trial: ' || e::text;
  assert (e->>'trial_ends_at')::timestamptz between now() + interval '13 days' and now() + interval '15 days', 'trial de 14 dias';
  assert (e #>> '{limits,max_members}')::int = 3 and (e #>> '{usage,members}')::int = 1, 'limites/uso: ' || e::text;
end $$;

-- 4. Tenant renomeia, mas não muda status nem plano.
update public.workspaces set name = 'Pousada Renomeada' where id = current_setting('test.ws')::uuid;
do $$ begin
  update public.workspaces set status = 'active' where id = current_setting('test.ws')::uuid;
  raise exception 'tenant não pode alterar o próprio status';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.workspaces set limit_overrides = '{"max_members": 99}' where id = current_setting('test.ws')::uuid;
  raise exception 'tenant não pode alterar os próprios limites';
exception when insufficient_privilege then null;
end $$;

-- 5. Limite de membros do plano (3): dono + 2; o terceiro convidado é recusado.
select public.add_workspace_member(current_setting('test.ws')::uuid, 'm1@cliente.com', 'agent');
select public.add_workspace_member(current_setting('test.ws')::uuid, 'm2@cliente.com', 'agent');
do $$ begin
  perform public.add_workspace_member(current_setting('test.ws')::uuid, 'm3@cliente.com', 'agent');
  raise exception 'deveria recusar acima do limite';
exception when program_limit_exceeded then null;
end $$;
-- Mudar o papel de quem já é membro não conta como novo membro.
select public.add_workspace_member(current_setting('test.ws')::uuid, 'm2@cliente.com', 'admin');

-- 6. Outro usuário não lê os direitos do tenant; o admin da plataforma lê.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
do $$ begin
  perform public.get_workspace_entitlements(current_setting('test.ws')::uuid);
  raise exception 'estranho não pode ler direitos';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$ begin
  assert public.get_workspace_entitlements(current_setting('test.ws')::uuid)->>'status' = 'trial', 'admin da plataforma lê qualquer tenant';
end $$;

-- 7. Override por cliente, trial vencido e suspensão (feitos pela plataforma via service_role).
reset role;
update public.workspaces set limit_overrides = '{"max_members": 10, "ai_enabled": false}' where id = current_setting('test.ws')::uuid;
do $$
declare e jsonb := public.get_workspace_entitlements(current_setting('test.ws')::uuid);
begin
  assert (e #>> '{limits,max_members}')::int = 10 and (e #>> '{limits,ai_enabled}')::boolean = false, 'override: ' || e::text;
end $$;
update public.workspaces set trial_ends_at = now() - interval '1 day' where id = current_setting('test.ws')::uuid;
do $$
declare e jsonb := public.get_workspace_entitlements(current_setting('test.ws')::uuid);
begin
  assert e->>'effective_status' = 'trial_expired' and not (e->>'active')::boolean, 'trial vencido: ' || e::text;
end $$;
update public.workspaces set status = 'suspended', suspended_reason = 'inadimplência', trial_ends_at = null where id = current_setting('test.ws')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  perform public.add_workspace_member(current_setting('test.ws')::uuid, 'm3@cliente.com', 'agent');
  raise exception 'tenant suspenso não adiciona membros';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  assert (select count(*) from public.workspaces) = 1, 'dono continua vendo o próprio workspace suspenso';
  assert (select count(*) from public.plans) >= 3, 'planos visíveis para tenants';
end $$;

-- 8. Execução restrita.
do $$ begin
  perform public.provision_workspace('x', auth.uid(), null, 'active', null, auth.uid());
  raise exception 'authenticated não pode provisionar direto';
exception when insufficient_privilege then null;
end $$;

-- 9. Painel de atendimentos: só membros (ou a plataforma) leem; o cálculo interno não é exposto.
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
set role authenticated;
do $$ begin
  perform public.get_dashboard(current_setting('test.ws')::uuid, current_date - 6, current_date);
  raise exception 'estranho não pode ler o painel';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.dashboard_period_kpis(current_setting('test.ws')::uuid, now() - interval '1 day', now(), null);
  raise exception 'cálculo interno não pode ser chamado direto';
exception when insufficient_privilege then null;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare d jsonb := public.get_dashboard(current_setting('test.ws')::uuid, current_date - 6, current_date);
begin
  assert (d #>> '{current,conversations}')::int = 0 and jsonb_array_length(d->'series') = 7 and jsonb_array_length(d->'by_hour') = 24, 'painel: ' || d::text;
  assert jsonb_array_length(public.get_dashboard(current_setting('test.ws')::uuid, current_date, current_date)->'series') = 24, 'um dia = 24 horas';
end $$;

reset role;
select 'Platform smoke OK' as result;
rollback;
