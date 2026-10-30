-- Setores e transferência: admin cadastra setores, membros; transferir para operador e para setor; visibilidade por setor. ROLLBACK no fim.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('99999999-0000-0000-0000-000000000031', 'dona@setor.com', 'authenticated', 'authenticated'),
  ('99999999-0000-0000-0000-000000000032', 'ana@setor.com', 'authenticated', 'authenticated'),
  ('99999999-0000-0000-0000-000000000033', 'bia@setor.com', 'authenticated', 'authenticated');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000031","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Setor')::text, true);
select public.add_workspace_member(current_setting('test.ws')::uuid, 'ana@setor.com', 'agent');
select public.add_workspace_member(current_setting('test.ws')::uuid, 'bia@setor.com', 'agent');

-- 1. Dona cria setores e vincula: Ana → Reservas; Bia → Financeiro.
insert into public.departments (id, workspace_id, name) values
  ('d0000000-0000-0000-0000-000000000001', current_setting('test.ws')::uuid, 'Reservas'),
  ('d0000000-0000-0000-0000-000000000002', current_setting('test.ws')::uuid, 'Financeiro');
insert into public.department_members (department_id, workspace_id, user_id) values
  ('d0000000-0000-0000-0000-000000000001', current_setting('test.ws')::uuid, '99999999-0000-0000-0000-000000000032'),
  ('d0000000-0000-0000-0000-000000000002', current_setting('test.ws')::uuid, '99999999-0000-0000-0000-000000000033');
do $$ begin
  begin
    insert into public.department_members (department_id, workspace_id, user_id) values ('d0000000-0000-0000-0000-000000000001', current_setting('test.ws')::uuid, '99999999-0000-0000-0000-000000000099');
    raise exception 'não membro do workspace não entra no setor';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into public.conversations (id, workspace_id, channel, contact_phone, mode) values
  ('c0000000-0000-0000-0000-000000000011', current_setting('test.ws')::uuid, 'whatsapp', '5548999990011', 'human'),
  ('c0000000-0000-0000-0000-000000000012', current_setting('test.ws')::uuid, 'whatsapp', '5548999990012', 'bot');
insert into public.workspace_routing (workspace_id, assignment_mode, agent_visibility) values (current_setting('test.ws')::uuid, 'shared', 'own');

-- 2. Ana (atendente) transfere a conversa 11 para a Bia com uma nota: Bia vira a operadora, fica mensagem de sistema e auditoria.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000032","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.transfer_conversation('c0000000-0000-0000-0000-000000000011', '99999999-0000-0000-0000-000000000033', null, 'Cliente quer 2ª via do boleto');
  assert r->>'assigned_user_id' = '99999999-0000-0000-0000-000000000033', 'Bia operadora: ' || r::text;
  -- Agora a conversa é da Bia: com visibilidade "own", a Ana não a vê mais (nem as mensagens dela).
  assert (select count(*) from public.conversations where id = 'c0000000-0000-0000-0000-000000000011') = 0, 'Ana não vê mais a conversa da Bia';
end $$;
reset role;
do $$ begin
  assert (select content from public.messages where conversation_id = 'c0000000-0000-0000-0000-000000000011' and sender = 'system') = 'Transferida por ana para bia: Cliente quer 2ª via do boleto', 'mensagem de sistema';
  assert (select count(*) from public.audit_logs where action = 'conversation.transferred' and details->>'to_user_id' = '99999999-0000-0000-0000-000000000033') = 1, 'auditoria';
end $$;
set local role authenticated;

-- 3. Transferir para um setor: a conversa 12 (com o bot) vai para Financeiro sem dono; só a Bia (do setor) e a dona veem.
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000031","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.transfer_conversation('c0000000-0000-0000-0000-000000000012', null, 'd0000000-0000-0000-0000-000000000002', null);
  assert r->>'assigned_user_id' is null and r->>'department_id' = 'd0000000-0000-0000-0000-000000000002', 'setor sem dono: ' || r::text;
  assert (select mode from public.conversations where id = 'c0000000-0000-0000-0000-000000000012') = 'human', 'sai do bot';
  assert (select content from public.messages where conversation_id = 'c0000000-0000-0000-0000-000000000012' and sender = 'system') = 'Transferida por dona para o setor Financeiro', 'mensagem do setor';
end $$;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000032","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.conversations where id = 'c0000000-0000-0000-0000-000000000012') = 0, 'Ana (Reservas) não vê a fila do Financeiro';
end $$;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000033","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.conversations where id = 'c0000000-0000-0000-0000-000000000012') = 1, 'Bia (Financeiro) vê a fila do seu setor';
end $$;

-- 4. Rodízio dentro do setor: transferir para Reservas com rodízio ligado entrega direto à Ana (única do setor).
reset role;
update public.workspace_routing set assignment_mode = 'round_robin' where workspace_id = current_setting('test.ws')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000031","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.transfer_conversation('c0000000-0000-0000-0000-000000000012', null, 'd0000000-0000-0000-0000-000000000001', null);
  assert r->>'assigned_user_id' = '99999999-0000-0000-0000-000000000032', 'rodízio no setor → Ana: ' || r::text;
  assert (select content from public.messages where conversation_id = 'c0000000-0000-0000-0000-000000000012' and sender = 'system' order by seq desc limit 1) = 'Transferida por dona para ana (setor Reservas)', 'mensagem com operador e setor';
end $$;

-- 5. Sem alvo ou alvo de fora: recusa.
do $$ begin
  begin
    perform public.transfer_conversation('c0000000-0000-0000-0000-000000000012', null, null, null);
    raise exception 'sem alvo deveria falhar';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.transfer_conversation('c0000000-0000-0000-0000-000000000012', '99999999-0000-0000-0000-000000000099', null, null);
    raise exception 'não membro deveria falhar';
  exception when invalid_parameter_value then null;
  end;
end $$;
rollback;
