-- Respostas rápidas: admin cadastra, atendente só lê, outro workspace não vê, atalho validado. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('99999999-0000-0000-0000-000000000021', 'dona@rapida.com', 'authenticated', 'authenticated'),
  ('99999999-0000-0000-0000-000000000022', 'ana@rapida.com', 'authenticated', 'authenticated'),
  ('99999999-0000-0000-0000-000000000023', 'fora@rapida.com', 'authenticated', 'authenticated');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000021","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Rápida')::text, true);
select public.add_workspace_member(current_setting('test.ws')::uuid, 'ana@rapida.com', 'agent');

-- 1. Dona cadastra; anexo só da pasta outbound do próprio workspace; atalho inválido é recusado.
insert into public.quick_replies (workspace_id, shortcut, title, content) values (current_setting('test.ws')::uuid, 'pix', 'Chave PIX', 'Nossa chave PIX é o CNPJ 00.000.000/0001-00.');
insert into public.quick_replies (workspace_id, shortcut, title, content, media_path, media_name, media_mime)
  values (current_setting('test.ws')::uuid, 'mapa', 'Como chegar', 'Segue o mapa.', current_setting('test.ws') || '/outbound/mapa.pdf', 'mapa.pdf', 'application/pdf');
do $$ begin
  begin
    insert into public.quick_replies (workspace_id, shortcut, title, content) values (current_setting('test.ws')::uuid, 'Com Espaço', 'x', 'y');
    raise exception 'atalho inválido deveria falhar';
  exception when check_violation then null;
  end;
  begin
    insert into public.quick_replies (workspace_id, shortcut, title, content, media_path) values (current_setting('test.ws')::uuid, 'outro', 'x', 'y', 'outro-ws/outbound/a.pdf');
    raise exception 'anexo de outra pasta deveria falhar';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.quick_replies (workspace_id, shortcut, title, content) values (current_setting('test.ws')::uuid, 'pix', 'Repetido', 'z');
    raise exception 'atalho repetido deveria falhar';
  exception when unique_violation then null;
  end;
end $$;

-- 2. Atendente lê as duas, mas não cadastra nem apaga.
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000022","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.quick_replies) = 2, 'atendente vê as respostas';
  begin
    insert into public.quick_replies (workspace_id, shortcut, title, content) values (current_setting('test.ws')::uuid, 'ana', 'x', 'y');
    raise exception 'atendente não deveria cadastrar';
  exception when insufficient_privilege then null;
  end;
  delete from public.quick_replies where shortcut = 'pix';
  assert (select count(*) from public.quick_replies where shortcut = 'pix') = 1, 'atendente não apaga';
end $$;

-- 3. Quem não é do workspace não vê nada.
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000023","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.quick_replies) = 0, 'fora do workspace não vê';
end $$;
rollback;
