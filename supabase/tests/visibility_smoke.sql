-- Auditoria 2026-11-14, lote 1: com agent_visibility = 'own', o dashboard, "assumir", "ficar com este cliente",
-- os anexos recebidos e user_label respeitam quem pode ver o quê. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('99999999-0000-0000-0000-000000000021', 'dona@vis.com', 'authenticated', 'authenticated', '{}'),
  ('99999999-0000-0000-0000-000000000022', 'ana@vis.com', 'authenticated', 'authenticated', '{"full_name": "Ana Vis"}'),
  ('99999999-0000-0000-0000-000000000023', 'bia@vis.com', 'authenticated', 'authenticated', '{}'),
  ('99999999-0000-0000-0000-000000000024', 'fora@vis.com', 'authenticated', 'authenticated', '{"full_name": "Fora Vis"}');
update public.platform_settings set value = 'true' where key = 'allow_self_service_workspaces';
grant select, insert on storage.objects to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000021","role":"authenticated"}', true);
select set_config('test.ws', public.create_workspace('Pousada Vis')::text, true);
select public.add_workspace_member(current_setting('test.ws')::uuid, 'ana@vis.com', 'agent');
select public.add_workspace_member(current_setting('test.ws')::uuid, 'bia@vis.com', 'agent');
reset role;
insert into public.workspace_routing (workspace_id, assignment_mode, agent_visibility, sticky_claim)
  values (current_setting('test.ws')::uuid, 'portfolio', 'own', false);
-- Conversa 1 é da Ana (humana, cliente esperando resposta); conversa 2 não tem dono.
insert into public.conversations (id, workspace_id, channel, contact_phone, contact_name, mode, assigned_user_id) values
  ('c0000000-0000-0000-0000-000000000021', current_setting('test.ws')::uuid, 'whatsapp', '5548999990021', 'Cliente Um', 'human', '99999999-0000-0000-0000-000000000022'),
  ('c0000000-0000-0000-0000-000000000022', current_setting('test.ws')::uuid, 'whatsapp', '5548999990022', 'Cliente Dois', 'human', null);
insert into public.messages (workspace_id, conversation_id, direction, sender, type, content, created_at) values
  (current_setting('test.ws')::uuid, 'c0000000-0000-0000-0000-000000000021', 'inbound', 'customer', 'text', 'oi, ainda tem vaga?', now() - interval '10 minutes'),
  (current_setting('test.ws')::uuid, 'c0000000-0000-0000-0000-000000000022', 'inbound', 'customer', 'text', 'bom dia', now() - interval '10 minutes');
insert into public.contact_assignments (workspace_id, phone, user_id) values (current_setting('test.ws')::uuid, '5548999990021', '99999999-0000-0000-0000-000000000022');
insert into storage.objects (bucket_id, name) values
  ('inbox-media', current_setting('test.ws') || '/c0000000-0000-0000-0000-000000000021/m1.jpg'),
  ('inbox-media', current_setting('test.ws') || '/c0000000-0000-0000-0000-000000000022/m2.jpg'),
  ('inbox-media', current_setting('test.ws') || '/outbound/o1.pdf');

-- 1. Bia (atendente, visibilidade "own"): o dashboard não lista a conversa da Ana na fila "aguardando".
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000023","role":"authenticated"}', true);
do $$
declare d jsonb;
begin
  d := public.get_dashboard(current_setting('test.ws')::uuid, current_date, current_date);
  assert jsonb_array_length(d->'waiting') = 1, 'Bia vê só a sem dono: ' || (d->'waiting')::text;
  assert d->'waiting'->0->>'conversation_id' = 'c0000000-0000-0000-0000-000000000022', 'a listada é a sem dono';
end $$;

-- 2. Bia não assume nem fica com o cliente da Ana; assume a sem dono normalmente.
do $$
declare r jsonb;
begin
  begin
    r := public.claim_conversation('c0000000-0000-0000-0000-000000000021', true);
    raise exception 'Bia não deveria assumir a conversa da Ana';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_contact('c0000000-0000-0000-0000-000000000021');
    raise exception 'Bia não deveria ficar com o cliente da Ana';
  exception when insufficient_privilege then null;
  end;
  r := public.claim_conversation('c0000000-0000-0000-0000-000000000022');
  assert (r->>'claimed')::boolean, 'assumiu a sem dono: ' || r::text;
  perform public.claim_contact('c0000000-0000-0000-0000-000000000022');
  assert (select user_id from public.contact_assignments where phone = '5548999990022') = '99999999-0000-0000-0000-000000000023', 'ficou com o cliente sem dono';
end $$;

-- 3. Anexos recebidos: Bia lê o da conversa que vê e o outbound, não o da conversa da Ana.
do $$ begin
  assert (select count(*) from storage.objects where name like '%/m2.jpg') = 1, 'anexo da própria conversa';
  assert (select count(*) from storage.objects where name like '%/outbound/o1.pdf') = 1, 'anexo enviado pela equipe';
  assert (select count(*) from storage.objects where name like '%/m1.jpg') = 0, 'anexo da conversa da Ana fica fechado';
end $$;

-- 4. A dona vê tudo no dashboard e nos anexos.
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000021","role":"authenticated"}', true);
do $$ begin
  assert jsonb_array_length(public.get_dashboard(current_setting('test.ws')::uuid, current_date, current_date)->'waiting') = 2, 'dona vê as duas';
  assert (select count(*) from storage.objects where bucket_id = 'inbox-media' and name like current_setting('test.ws') || '/%') = 3, 'dona lê os três anexos';
end $$;

-- 5. user_label: colega do workspace resolve; usuário de fora não.
do $$ begin
  assert public.user_label('99999999-0000-0000-0000-000000000022') = 'Ana Vis', 'colega resolve';
  assert public.user_label('99999999-0000-0000-0000-000000000024') is null, 'quem não compartilha workspace não resolve';
  assert public.sticky_enabled(current_setting('test.ws')::uuid) = false, 'membro lê a flag';
end $$;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000024","role":"authenticated"}', true);
do $$ begin
  assert public.user_label('99999999-0000-0000-0000-000000000022') is null, 'de fora não resolve ninguém';
  assert public.sticky_enabled(current_setting('test.ws')::uuid) is null, 'de fora não lê a flag';
end $$;

-- 6. O QR de pareamento não está no grant de colunas.
do $$ begin
  begin
    perform qr_code from public.whatsapp_instances limit 1;
    raise exception 'qr_code deveria estar oculto';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
