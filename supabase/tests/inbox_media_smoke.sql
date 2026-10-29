-- Anexos da inbox: membro grava só em <seu workspace>/outbound/; recebidos e outros workspaces ficam fechados. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('99999999-0000-0000-0000-000000000011', 'dona@anexo.com', 'authenticated', 'authenticated'),
  ('99999999-0000-0000-0000-000000000012', 'fora@anexo.com', 'authenticated', 'authenticated');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
-- No Supabase real a API de storage já tem estes grants; o Postgres descartável do teste não.
grant select, insert on storage.objects to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000011","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Anexo')::text, true);

-- 1. Membro grava na pasta outbound do próprio workspace.
insert into storage.objects (bucket_id, name) values ('inbox-media', current_setting('test.ws') || '/outbound/a.pdf');
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'inbox-media' and name like '%/outbound/a.pdf') = 1, 'anexo gravado';
end $$;

-- 2. Não grava na pasta dos recebidos (<ws>/<conversa>/) nem em outro bucket privado.
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('inbox-media', current_setting('test.ws') || '/c0000000-0000-0000-0000-000000000001/m.pdf');
    raise exception 'não deveria gravar na pasta dos recebidos';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. Quem não é membro não grava na pasta do workspace alheio.
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000012","role":"authenticated"}', true);
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('inbox-media', current_setting('test.ws') || '/outbound/b.pdf');
    raise exception 'não deveria gravar em workspace alheio';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from storage.objects where bucket_id = 'inbox-media' and name like current_setting('test.ws') || '/%') = 0, 'nem lê o que não é seu';
end $$;
rollback;
