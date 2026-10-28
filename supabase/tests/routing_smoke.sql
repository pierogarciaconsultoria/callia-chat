-- Distribuição de conversas: carteira, rodízio, visibilidade por papel e "assumir" com conflito. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values
  ('99999999-0000-0000-0000-000000000001', 'dona@rota.com', 'authenticated', 'authenticated'),
  ('99999999-0000-0000-0000-000000000002', 'ana@rota.com', 'authenticated', 'authenticated'),
  ('99999999-0000-0000-0000-000000000003', 'bia@rota.com', 'authenticated', 'authenticated');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Rota')::text, true);
select public.add_workspace_member(current_setting('test.ws')::uuid, 'ana@rota.com', 'agent');
select public.add_workspace_member(current_setting('test.ws')::uuid, 'bia@rota.com', 'agent');
reset role;
-- Três conversas de clientes diferentes.
insert into public.conversations (id, workspace_id, channel, contact_phone, mode) values
  ('c0000000-0000-0000-0000-000000000001', current_setting('test.ws')::uuid, 'whatsapp', '5548999990001', 'bot'),
  ('c0000000-0000-0000-0000-000000000002', current_setting('test.ws')::uuid, 'whatsapp', '5548999990002', 'bot'),
  ('c0000000-0000-0000-0000-000000000003', current_setting('test.ws')::uuid, 'whatsapp', '5548999990003', 'bot');

-- 1. Fila compartilhada (padrão): rotear não atribui ninguém.
do $$ begin
  assert public.route_conversation('c0000000-0000-0000-0000-000000000001') is null, 'shared não atribui';
end $$;

-- 2. Carteira: o número da Ana cai para a Ana; número sem carteira fica sem dono.
insert into public.workspace_routing (workspace_id, assignment_mode, agent_visibility, sticky_claim) values (current_setting('test.ws')::uuid, 'portfolio', 'own', true);
insert into public.contact_assignments (workspace_id, phone, user_id) values (current_setting('test.ws')::uuid, '5548999990001', '99999999-0000-0000-0000-000000000002');
update public.conversations set mode = 'human' where id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002');
do $$ begin
  assert public.route_conversation('c0000000-0000-0000-0000-000000000001') = '99999999-0000-0000-0000-000000000002', 'carteira → Ana';
  assert public.route_conversation('c0000000-0000-0000-0000-000000000002') is null, 'sem carteira → sem dono';
end $$;

-- 3. Visibilidade "own": Bia (atendente) não vê a conversa da Ana, vê a sem dono; a dona vê tudo.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.conversations where id = 'c0000000-0000-0000-0000-000000000001') = 0, 'Bia não vê a conversa da Ana';
  assert (select count(*) from public.conversations where id = 'c0000000-0000-0000-0000-000000000002') = 1, 'Bia vê a sem dono';
end $$;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.conversations) = 3, 'dona vê tudo';
end $$;

-- 4. Assumir: Bia assume a sem dono (vira operadora do número, sticky); tentar assumir a da Ana avisa conflito; com força, assume.
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.claim_conversation('c0000000-0000-0000-0000-000000000002');
  assert (r->>'claimed')::boolean, 'assumiu a sem dono: ' || r::text;
  assert (select user_id from public.contact_assignments where phone = '5548999990002') = '99999999-0000-0000-0000-000000000003', 'sticky: número entrou na carteira da Bia';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.claim_conversation('c0000000-0000-0000-0000-000000000001');
  assert (r->>'conflict')::boolean and r->>'assigned_user_id' = '99999999-0000-0000-0000-000000000002', 'conflito com a Ana: ' || r::text;
  r := public.claim_conversation('c0000000-0000-0000-0000-000000000001', true);
  assert (r->>'claimed')::boolean, 'assumiu mesmo assim';
  assert (select count(*) from public.audit_logs where action = 'conversation.claimed' and (details->>'force')::boolean) = 1, 'auditoria do "mesmo assim"';
end $$;

-- 5. Rodízio: quem tem menos conversas em atendimento recebe a próxima.
reset role;
update public.workspace_routing set assignment_mode = 'round_robin' where workspace_id = current_setting('test.ws')::uuid;
update public.conversations set mode = 'human', assigned_user_id = null where id = 'c0000000-0000-0000-0000-000000000003';
do $$
declare v uuid;
begin
  -- dona: 1 conversa (c1); Bia: 1 (c2); Ana: 0 → Ana recebe.
  v := public.route_conversation('c0000000-0000-0000-0000-000000000003');
  assert v = '99999999-0000-0000-0000-000000000002', 'rodízio escolheu quem tem menos: ' || coalesce(v::text, 'null');
  assert public.route_conversation('c0000000-0000-0000-0000-000000000003') = v, 'reenvio mantém o mesmo operador';
end $$;
rollback;
