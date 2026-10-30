-- Aprendizados: admin lê sugestões e análises do próprio workspace; atendente e outro workspace não veem; ninguém grava
-- pelo cliente; learning_due_workspaces lista só empresas com mensagem de cliente nova. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000031', 'dona@aprende.com', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000032', 'ana@aprende.com', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000033', 'fora@aprende.com', 'authenticated', 'authenticated');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000031","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Aprende')::text, true);
select public.add_workspace_member(current_setting('test.ws')::uuid, 'ana@aprende.com', 'agent');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000033","role":"authenticated"}', true);
select set_config('test.ws_b', public.create_workspace('Loja Fora')::text, true);
reset role;

-- A function (service_role) grava uma análise (encerrada há 1 h: dentro da transação now() não avança) e uma sugestão;
-- pendente repetida é barrada pelo índice único.
insert into public.learning_runs (id, workspace_id, period_start, period_end, status, conversations_analyzed, suggestions_created)
  values ('bbbbbbbb-0000-0000-0000-000000000001', current_setting('test.ws')::uuid, now() - interval '1 day', now() - interval '1 hour', 'done', 3, 1);
insert into public.learning_suggestions (workspace_id, run_id, kind, fingerprint, title, rationale, payload, evidence)
  values (current_setting('test.ws')::uuid, 'bbbbbbbb-0000-0000-0000-000000000001', 'faq', 'faq:aceita pet', 'Pets', 'Cliente perguntou e a IA transferiu.',
          '{"question":"Aceita pet?","answer":null}', '[{"conversation_id":"00000000-0000-0000-0000-000000000001","contact":"Ana","excerpts":[]}]');
do $$ begin
  begin
    insert into public.learning_suggestions (workspace_id, kind, fingerprint, title, rationale) values (current_setting('test.ws')::uuid, 'faq', 'faq:aceita pet', 'Pets de novo', 'x');
    raise exception 'pendente repetida deveria falhar';
  exception when unique_violation then null;
  end;
  begin
    insert into public.learning_suggestions (workspace_id, kind, fingerprint, title, rationale) values (current_setting('test.ws')::uuid, 'preco', 'x:y', 'Tipo inválido', 'x');
    raise exception 'tipo inválido deveria falhar';
  exception when check_violation then null;
  end;
end $$;

-- 1. Dona (admin) lê; não grava.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000031","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.learning_suggestions) = 1, 'admin lê a sugestão';
  assert (select count(*) from public.learning_runs) = 1, 'admin lê a análise';
  begin
    update public.learning_suggestions set status = 'applied';
    raise exception 'cliente não deveria alterar sugestão';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.learning_runs (workspace_id, period_start, period_end) values (current_setting('test.ws')::uuid, now(), now());
    raise exception 'cliente não deveria criar análise';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 2. Atendente e quem é de outro workspace não veem nada.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000032","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.learning_suggestions) = 0, 'atendente não vê sugestões';
  assert (select count(*) from public.learning_runs) = 0, 'atendente não vê análises';
end $$;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000033","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.learning_suggestions) = 0, 'outro workspace não vê';
  begin
    perform public.learning_due_workspaces();
    raise exception 'cliente não deveria chamar learning_due_workspaces';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. Empresas a analisar: só com mensagem de cliente depois da última análise concluída.
reset role;
do $$
declare
  v_conv uuid;
  v_msg uuid;
begin
  assert (select count(*) from public.learning_due_workspaces()) = 0, 'sem mensagens novas, nada a analisar';
  insert into public.conversations (workspace_id, contact_phone, contact_name) values (current_setting('test.ws')::uuid, '5548999990000', 'Ana') returning id into v_conv;
  insert into public.messages (workspace_id, conversation_id, direction, sender, content) values (current_setting('test.ws')::uuid, v_conv, 'inbound', 'customer', 'aceita pet?') returning id into v_msg;
  assert (select count(*) from public.learning_due_workspaces() where workspace_id = current_setting('test.ws')::uuid) = 1, 'mensagem nova de cliente põe a empresa na fila';
  assert (select since from public.learning_due_workspaces() where workspace_id = current_setting('test.ws')::uuid)
         = (select period_end from public.learning_runs where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'desde = fim da última análise';
  update public.agent_configs set enabled = false where workspace_id = current_setting('test.ws')::uuid;
  assert (select count(*) from public.learning_due_workspaces() where workspace_id = current_setting('test.ws')::uuid) = 0, 'agente desligado não entra na fila';
end $$;
rollback;
