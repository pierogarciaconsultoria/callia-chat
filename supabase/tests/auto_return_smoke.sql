-- Devolução automática ao bot: só conversas humanas paradas além do limite, em que a equipe respondeu; mensagem de
-- sistema e auditoria; a pendente do cliente é devolvida para a IA responder. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('dddddddd-0000-0000-0000-000000000051', 'dona@volta.com', 'authenticated', 'authenticated');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000051","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Volta')::text, true);
reset role;
do $$ begin
  assert (select auto_return_minutes from public.agent_configs where workspace_id = current_setting('test.ws')::uuid) = 30, 'padrão 30 min';
  begin
    update public.agent_configs set auto_return_minutes = 2 where workspace_id = current_setting('test.ws')::uuid;
    raise exception 'abaixo de 5 min deveria falhar';
  exception when check_violation then null;
  end;
end $$;

-- c1: equipe respondeu, parada há 2 h, última é do cliente → volta, com pendência.
-- c2: equipe respondeu, parada há 2 h, última é da equipe → volta, sem pendência.
-- c3: IA transferiu e ninguém respondeu → não volta (evita o pingue-pongue).
-- c4: equipe respondeu, mas cliente escreveu há 10 min → não volta.
-- c5: encerrada → não volta.
insert into public.conversations (id, workspace_id, channel, contact_phone, mode, handoff_at, last_message_at) values
  ('d0000000-0000-0000-0000-000000000001', current_setting('test.ws')::uuid, 'whatsapp', '5548999990001', 'human', now() - interval '3 hours', now() - interval '2 hours'),
  ('d0000000-0000-0000-0000-000000000002', current_setting('test.ws')::uuid, 'whatsapp', '5548999990002', 'human', now() - interval '3 hours', now() - interval '2 hours'),
  ('d0000000-0000-0000-0000-000000000003', current_setting('test.ws')::uuid, 'whatsapp', '5548999990003', 'human', now() - interval '3 hours', now() - interval '2 hours'),
  ('d0000000-0000-0000-0000-000000000004', current_setting('test.ws')::uuid, 'whatsapp', '5548999990004', 'human', now() - interval '3 hours', now() - interval '10 minutes'),
  ('d0000000-0000-0000-0000-000000000005', current_setting('test.ws')::uuid, 'whatsapp', '5548999990005', 'closed', now() - interval '3 hours', now() - interval '2 hours');
insert into public.messages (workspace_id, conversation_id, direction, sender, content, created_at) values
  (current_setting('test.ws')::uuid, 'd0000000-0000-0000-0000-000000000001', 'outbound', 'agent', 'Oi, aqui é a Ana', now() - interval '2 hours 30 minutes'),
  (current_setting('test.ws')::uuid, 'd0000000-0000-0000-0000-000000000001', 'inbound', 'customer', 'tem vaga em janeiro?', now() - interval '2 hours'),
  (current_setting('test.ws')::uuid, 'd0000000-0000-0000-0000-000000000002', 'inbound', 'customer', 'obrigado!', now() - interval '2 hours 10 minutes'),
  (current_setting('test.ws')::uuid, 'd0000000-0000-0000-0000-000000000002', 'outbound', 'agent', 'Por nada, até mais!', now() - interval '2 hours'),
  (current_setting('test.ws')::uuid, 'd0000000-0000-0000-0000-000000000003', 'inbound', 'customer', 'quero falar com uma pessoa', now() - interval '2 hours'),
  (current_setting('test.ws')::uuid, 'd0000000-0000-0000-0000-000000000004', 'outbound', 'agent', 'Já vejo', now() - interval '1 hour'),
  (current_setting('test.ws')::uuid, 'd0000000-0000-0000-0000-000000000004', 'inbound', 'customer', 'e aí?', now() - interval '10 minutes'),
  (current_setting('test.ws')::uuid, 'd0000000-0000-0000-0000-000000000005', 'outbound', 'agent', 'Encerrado', now() - interval '2 hours');
-- Os inserts acima podem ter atualizado last_message_at por gatilho; fixa os cenários.
update public.conversations set last_message_at = now() - interval '2 hours' where id in ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000005');
update public.conversations set last_message_at = now() - interval '10 minutes' where id = 'd0000000-0000-0000-0000-000000000004';

do $$
declare
  n int;
  v_pending uuid;
begin
  select count(*) into n from public.auto_return_idle_conversations();
  assert n = 2, 'devolveu exatamente c1 e c2, devolveu ' || n;
  assert (select mode from public.conversations where id = 'd0000000-0000-0000-0000-000000000001') = 'bot', 'c1 voltou ao bot';
  assert (select mode from public.conversations where id = 'd0000000-0000-0000-0000-000000000003') = 'human', 'c3 segue com a equipe';
  assert (select mode from public.conversations where id = 'd0000000-0000-0000-0000-000000000004') = 'human', 'c4 segue com a equipe';
  assert (select mode from public.conversations where id = 'd0000000-0000-0000-0000-000000000005') = 'closed', 'c5 segue encerrada';
  assert (select count(*) from public.messages where sender = 'system' and metadata->>'event' = 'auto_return') = 2, 'mensagem de sistema nas duas';
  assert (select count(*) from public.audit_logs where action = 'conversation.auto_returned') = 2, 'auditoria nas duas';
  -- Segunda rodada: nada mais a devolver (já estão em bot).
  select count(*) into n from public.auto_return_idle_conversations();
  assert n = 0, 'idempotente';
end $$;
-- Pendência: c1 devolve o id da pergunta do cliente; c2 não (última é da equipe). Refaz c1/c2 para testar a saída.
update public.conversations set mode = 'human' where id in ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002');
delete from public.messages where sender = 'system';
do $$
declare
  r record;
begin
  for r in select * from public.auto_return_idle_conversations() loop
    if r.conversation_id = 'd0000000-0000-0000-0000-000000000001' then
      assert r.pending_message_id = (select id from public.messages where content = 'tem vaga em janeiro?'), 'c1 devolve a pergunta pendente';
    else
      assert r.pending_message_id is null, 'c2 sem pendência';
    end if;
  end loop;
end $$;
-- Desligado: nada volta.
update public.conversations set mode = 'human' where id = 'd0000000-0000-0000-0000-000000000001';
update public.agent_configs set auto_return_minutes = null where workspace_id = current_setting('test.ws')::uuid;
do $$ begin
  assert (select count(*) from public.auto_return_idle_conversations()) = 0, 'desligado não devolve';
end $$;
rollback;
