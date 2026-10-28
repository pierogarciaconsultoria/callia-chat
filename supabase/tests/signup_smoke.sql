-- Cadastro em autoatendimento: site público sem login e workspace criado com os dados do cadastro. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'nova@empresa.com', 'authenticated', 'authenticated',
   '{"company_name":"Pousada Nova","segment":"hotelaria","website":"https://pousadanova.com","whatsapp":"48999990000"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'google@empresa.com', 'authenticated', 'authenticated', '{}');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';

-- 1. Site público: planos e configurações sem login.
set local role anon;
do $$
declare s jsonb := public.public_site_info();
begin
  assert (s->>'self_service')::boolean, 'autoatendimento ligado: ' || s::text;
  assert (s->>'trial_days')::int = 14, 'trial_days: ' || s::text;
  assert jsonb_array_length(s->'plans') >= 3 and s #>> '{plans,0,code}' = 'trial', 'planos em ordem: ' || s::text;
  assert (s #>> '{plans,0,max_members}')::int = 3, 'limite do plano: ' || s::text;
end $$;

-- 2. Recém-cadastrado: workspace em trial com nome, segmento, site e telefone do cadastro; chamar de novo devolve o mesmo.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace_from_signup()::text, true);
do $$
declare ws uuid := current_setting('test.ws')::uuid; c record;
begin
  assert (select name from public.workspaces where id = ws) = 'Pousada Nova', 'nome';
  assert (select status::text from public.workspaces where id = ws) = 'trial', 'trial';
  select segment_id, website_url into c from public.agent_configs where workspace_id = ws;
  assert c.segment_id = 'hotelaria' and c.website_url = 'https://pousadanova.com', 'segmento/site: ' || c::text;
  assert (select phone from public.workspace_business_info where workspace_id = ws) = '48999990000', 'telefone';
  assert (select role::text from public.workspace_members where workspace_id = ws and user_id = auth.uid()) = 'owner', 'dono';
  assert public.create_workspace_from_signup('Outro Nome') = ws, 'idempotente: não cria um segundo workspace';
end $$;

-- 3. Login social (sem metadados): precisa informar o nome; com o nome, cria.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  perform public.create_workspace_from_signup();
  raise exception 'deveria exigir o nome da empresa';
exception when invalid_parameter_value then null;
end $$;
do $$
declare ws uuid := public.create_workspace_from_signup('Clínica Google', 'saude');
begin
  assert (select segment_id from public.agent_configs where workspace_id = ws) = 'saude', 'segmento pelo parâmetro';
  assert (select count(*) from public.workspace_business_info where workspace_id = ws) = 0, 'sem telefone, sem linha';
end $$;

-- 4. Autoatendimento desligado: o cadastro não cria workspace.
reset role;
update public.platform_settings set value = 'false' where key = 'allow_self_service_workspaces';
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('bbbbbbbb-0000-0000-0000-000000000003', 'tarde@empresa.com', 'authenticated', 'authenticated', '{"company_name":"Loja Tarde"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$ begin
  perform public.create_workspace_from_signup();
  raise exception 'deveria bloquear com autoatendimento desligado';
exception when insufficient_privilege then null;
end $$;

rollback;
