-- Nome de exibição: list_workspace_members devolve o nome dos metadados (ou null) e user_label cai no e-mail.
-- Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000041', 'dona@nomes.com', 'authenticated', 'authenticated', '{"full_name": "Ana Souza"}'),
  ('cccccccc-0000-0000-0000-000000000042', 'bia@nomes.com', 'authenticated', 'authenticated', '{}');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000041","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Nomes')::text, true);
select public.add_workspace_member(current_setting('test.ws')::uuid, 'bia@nomes.com', 'agent');
do $$ begin
  assert (select display_name from public.list_workspace_members(current_setting('test.ws')::uuid) where email = 'dona@nomes.com') = 'Ana Souza', 'nome vem dos metadados';
  assert (select display_name from public.list_workspace_members(current_setting('test.ws')::uuid) where email = 'bia@nomes.com') is null, 'sem nome fica null';
  assert public.user_label('cccccccc-0000-0000-0000-000000000041') = 'Ana Souza', 'rótulo usa o nome';
  assert public.user_label('cccccccc-0000-0000-0000-000000000042') = 'bia', 'rótulo cai no e-mail';
end $$;
rollback;
