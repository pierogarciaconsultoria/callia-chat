-- Políticas da empresa: admin escreve, membro lê, outro workspace não vê. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('cccccccc-0000-0000-0000-000000000001', 'dona@pousada.com', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000002', 'operador@pousada.com', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000003', 'outra@loja.com', 'authenticated', 'authenticated');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Políticas')::text, true);
select public.add_workspace_member(current_setting('test.ws')::uuid, 'operador@pousada.com', 'agent');
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.ws_b', public.create_workspace('Loja Outra')::text, true);

-- 1. Dona cria políticas; assunto fora do padrão é recusado.
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.workspace_policies (workspace_id, topic, title, content, position) values
  (current_setting('test.ws')::uuid, 'checkin', 'Check-in', 'A partir das 14h, até as 22h.', 0),
  (current_setting('test.ws')::uuid, 'pets', 'Animais', 'Não é permitido trazer animais de estimação.', 1);
do $$ begin
  insert into public.workspace_policies (workspace_id, topic, title, content) values (current_setting('test.ws')::uuid, 'Check In!', 'x', 'yy');
  raise exception 'assunto com espaço/maiúscula deveria ser recusado';
exception when check_violation then null;
end $$;

-- 2. Operador lê, mas não escreve.
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.workspace_policies) = 2, 'operador lê as políticas do próprio workspace';
  begin
    insert into public.workspace_policies (workspace_id, topic, title, content) values (current_setting('test.ws')::uuid, 'fumo', 'Fumo', 'Proibido.');
    raise exception 'operador não deveria criar política';
  exception when insufficient_privilege then null;
  end;
  update public.workspace_policies set title = 'Hackeado';
  assert (select count(*) from public.workspace_policies where title = 'Hackeado') = 0, 'operador não deveria alterar política';
end $$;

-- 3. Outro workspace não vê nada.
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.workspace_policies) = 0, 'políticas não vazam entre workspaces';
end $$;

rollback;
