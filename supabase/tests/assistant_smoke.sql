-- Propostas do assistente: admin lê as do próprio workspace; ninguém grava pelo cliente; outro workspace não vê. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('ffffffff-0000-0000-0000-000000000001', 'dona@assist.com', 'authenticated', 'authenticated'),
  ('ffffffff-0000-0000-0000-000000000002', 'operador@assist.com', 'authenticated', 'authenticated'),
  ('ffffffff-0000-0000-0000-000000000003', 'outra@loja.com', 'authenticated', 'authenticated');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Assistente')::text, true);
select public.add_workspace_member(current_setting('test.ws')::uuid, 'operador@assist.com', 'agent');
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.ws_b', public.create_workspace('Loja B')::text, true);

reset role;
insert into public.assistant_proposals (workspace_id, user_id, kind, title, changes, payload)
values (current_setting('test.ws')::uuid, 'ffffffff-0000-0000-0000-000000000001', 'price_table', 'Tabela de preços', array['Kitnet: 420 → 450'], '{"data":{}}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.assistant_proposals) = 1, 'dona lê a proposta';
  begin
    insert into public.assistant_proposals (workspace_id, user_id, kind, title, payload) values (current_setting('test.ws')::uuid, auth.uid(), 'policy', 'x', '{}');
    raise exception 'cliente não deveria criar proposta';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.assistant_proposals set status = 'applied';
    raise exception 'cliente não deveria alterar proposta';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.assistant_proposals) = 0, 'operador (agent) não vê propostas';
end $$;
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.assistant_proposals) = 0, 'outro workspace não vê';
end $$;
reset role;
do $$ begin
  insert into public.assistant_proposals (workspace_id, user_id, kind, title, payload) values (current_setting('test.ws')::uuid, 'ffffffff-0000-0000-0000-000000000001', 'coisa', 'x', '{}');
  raise exception 'kind fora da lista deveria falhar';
exception when check_violation then null;
end $$;
rollback;
