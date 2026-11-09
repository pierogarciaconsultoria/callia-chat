-- Teste de fumaça de RLS e RPCs. Rodar num banco descartável:
--   psql -v ON_ERROR_STOP=1 -1 -f supabase/tests/rls_smoke.sql   (termina com ROLLBACK)
begin;
-- Mesma definição que o GoTrue instala (a imagem crua do Postgres traz uma versão antiga).
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'ana@a.com', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'bia@b.com', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'caio@a.com', 'authenticated', 'authenticated');

-- Os usuários deste teste criam o próprio workspace (autoatendimento ligado só nesta transação).
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.ws_a', public.create_workspace('Pousada Alfa')::text, true);
select public.add_workspace_member(current_setting('test.ws_a')::uuid, 'caio@a.com', 'agent');
insert into public.faqs (workspace_id, question, answer)
  values (current_setting('test.ws_a')::uuid, 'Qual o horário do café da manhã?', 'Servimos café das 7h às 10h.');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select set_config('test.ws_b', public.create_workspace('Loja Beta')::text, true);

reset role;
-- Mensagem inbound gravada pelo backend (service_role), duas vezes com o mesmo external_id.
create temp table r1 as select * from public.record_message(current_setting('test.ws_a')::uuid, null, 'whatsapp',
  '5548999990000', 'Cliente', 'inbound', 'customer', 'text', 'Oi, qual horario do cafe?', null, null, 'wamid.1');
create temp table r2 as select * from public.record_message(current_setting('test.ws_a')::uuid, null, 'whatsapp',
  '5548999990000', 'Cliente', 'inbound', 'customer', 'text', 'Oi, qual horario do cafe?', null, null, 'wamid.1');
grant select on r1, r2 to authenticated;

do $$
declare v int;
begin
  assert (select duplicate from r1) = false, 'primeira gravação não deveria ser duplicada';
  assert (select duplicate from r2) = true, 'segunda gravação deveria ser duplicada';
  select unread_count into v from public.conversations where id = (select conversation_id from r1);
  assert v = 1, 'unread_count deveria ser 1, veio ' || v;
end $$;

set local role authenticated;
-- Ana (owner A) vê A, não vê B.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from public.workspaces) = 1, 'Ana deveria ver só 1 workspace';
  assert (select count(*) from public.messages) = 1, 'Ana deveria ver 1 mensagem';
  assert (select count(*) from public.knowledge_search(current_setting('test.ws_a')::uuid, 'que horas é o cafe da manha', null, 3)) = 1,
    'busca sem acento deveria encontrar a FAQ';
end $$;

-- Dados bancários de A (gravados pela dona de A).
insert into public.workspace_business_info (workspace_id, legal_name, pix_key_type, pix_key, share_payment_info)
  values (current_setting('test.ws_a')::uuid, 'Pousada Alfa Ltda', 'cnpj', '00.000.000/0001-00', true);

-- Bia (owner B) não enxerga nada de A, nem pela busca.
-- Ana (owner de A) salva a tela do agente: o painel manda todas as colunas editáveis de uma vez, então basta uma
-- coluna nova sem GRANT para o salvamento inteiro falhar (aconteceu com auto_return_minutes).
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare faltando text;
begin
  update public.agent_configs set persona_prompt = 'Sou a Ana', auto_return_minutes = 45, emoji_policy = 'none'
    where workspace_id = current_setting('test.ws_a')::uuid;
  assert (select auto_return_minutes from public.agent_configs where workspace_id = current_setting('test.ws_a')::uuid) = 45,
    'owner deveria salvar a config do agente';
  select string_agg(column_name, ', ' order by column_name) into faltando
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'agent_configs'
      and c.column_name not in ('workspace_id', 'updated_at')
      and not exists (select 1 from information_schema.column_privileges p
                      where p.table_schema = 'public' and p.table_name = 'agent_configs'
                        and p.column_name = c.column_name and p.grantee = 'authenticated' and p.privilege_type = 'UPDATE');
  assert faltando is null, 'colunas de agent_configs sem GRANT UPDATE para o painel: ' || faltando;
end $$;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from public.messages) = 0, 'Bia não deveria ver mensagens de A';
  assert (select count(*) from public.conversations) = 0, 'Bia não deveria ver conversas de A';
  assert (select count(*) from public.knowledge_search(current_setting('test.ws_a')::uuid, 'cafe', null, 3)) = 0,
    'Bia não deveria achar conhecimento de A';
  assert (select count(*) from public.workspace_business_info) = 0, 'Bia não pode ver dados bancários de A';
  update public.agent_configs set persona_prompt = 'hack' where workspace_id = current_setting('test.ws_a')::uuid;
  assert (select count(*) from public.agent_configs) = 1, 'Bia só vê a própria config';
end $$;

-- Caio (agent em A) atende, mas não administra.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from public.conversations) = 1, 'Caio deveria ver a conversa de A';
  update public.conversations set mode = 'human', unread_count = 0;
  assert (select mode from public.conversations) = 'human', 'Caio deveria conseguir assumir a conversa';
  assert (select count(*) from public.api_keys) = 0 and (select count(*) from public.audit_logs) = 0, 'Caio não vê área admin';
  -- Moderação (ocultar/apagar) só pela function message-actions: update direto em messages não pega nenhuma linha.
  update public.messages set hidden_at = now();
  assert (select count(*) from public.messages where hidden_at is not null) = 0, 'membro não oculta mensagem por update direto';
  assert (select count(*) from public.workspace_business_info) = 0, 'operador (agent) não vê dados bancários';
  begin
    insert into public.faqs (workspace_id, question, answer) values (current_setting('test.ws_a')::uuid, 'x', 'y');
    raise exception 'Caio não deveria criar FAQ';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_message(current_setting('test.ws_a')::uuid, null, 'whatsapp', '1', null, 'inbound', 'customer', 'text', 'x');
    raise exception 'authenticated não deveria executar record_message';
  exception when insufficient_privilege then null;
  end;
  begin
    perform key_hash from public.api_keys;
    raise exception 'key_hash deveria estar oculto';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  assert (select persona_prompt from public.agent_configs where workspace_id = current_setting('test.ws_a')::uuid) <> 'hack',
    'Bia não pode ter alterado a config de A';
end $$;
select 'RLS smoke OK' as result;
rollback;
