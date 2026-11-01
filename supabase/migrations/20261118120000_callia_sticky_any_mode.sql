-- Vínculo automático do cliente ao operador que assume, em qualquer modo de distribuição.
-- Antes só valia em "carteira". Agora, com sticky_claim ligado (padrão), assumir, responder primeiro ou receber a
-- transferência de uma conversa vincula o número do cliente ao operador (contact_assignments), e route_conversation
-- respeita esse vínculo em todos os modos: a próxima transferência da IA desse cliente cai para a mesma pessoa.

alter table public.workspace_routing alter column sticky_claim set default true;
update public.workspace_routing set sticky_claim = true where sticky_claim = false;

-- Vincula o número da conversa ao operador (quem assumiu por último fica com o cliente).
create or replace function public.link_contact_operator(p_conversation_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_phone text;
begin
  select workspace_id, regexp_replace(contact_phone, '[^0-9]', '', 'g') into v_ws, v_phone from conversations where id = p_conversation_id;
  if v_ws is null or p_user_id is null or v_phone !~ '^[0-9]{8,15}$' then return; end if;
  if not exists (select 1 from workspace_members where workspace_id = v_ws and user_id = p_user_id) then return; end if;
  insert into contact_assignments (workspace_id, phone, user_id, created_by) values (v_ws, v_phone, p_user_id, p_user_id)
    on conflict (workspace_id, phone) do update set user_id = excluded.user_id, created_by = excluded.created_by, created_at = now();
end $$;
revoke execute on function public.link_contact_operator(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_contact_operator(uuid, uuid) to service_role;

create or replace function public.sticky_enabled(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select sticky_claim from workspace_routing where workspace_id = p_workspace_id), true)
$$;
revoke execute on function public.sticky_enabled(uuid) from public, anon;
grant execute on function public.sticky_enabled(uuid) to authenticated, service_role;

-- Quem responde pela inbox assume a conversa (chamada pela function send-message, service_role): sai do bot e, se não
-- tinha dono, vira o operador; com vínculo ligado, fica com o cliente.
create or replace function public.assign_conversation_operator(p_conversation_id uuid, p_user_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_mode public.conversation_mode;
  v_assigned uuid;
  v_owner uuid;
begin
  select workspace_id, mode, assigned_user_id into v_ws, v_mode, v_assigned from conversations where id = p_conversation_id;
  if v_ws is null then return null; end if;
  v_owner := coalesce(v_assigned, p_user_id);
  if v_mode <> 'human' or v_assigned is null then
    update conversations set mode = 'human', assigned_user_id = v_owner,
      handoff_at = case when v_mode <> 'human' then now() else handoff_at end
      where id = p_conversation_id;
  end if;
  if v_owner = p_user_id and public.sticky_enabled(v_ws) then
    perform public.link_contact_operator(p_conversation_id, p_user_id);
  end if;
  return v_owner;
end $$;
revoke execute on function public.assign_conversation_operator(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_conversation_operator(uuid, uuid) to service_role;

-- Assumir pela inbox: vínculo do cliente em qualquer modo (antes só em carteira).
create or replace function public.claim_conversation(p_conversation_id uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_assigned uuid;
  v_mode text;
begin
  select workspace_id, assigned_user_id, mode into v_ws, v_assigned, v_mode from conversations where id = p_conversation_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_mode = 'human' and v_assigned is not null and v_assigned <> auth.uid() and not p_force then
    return jsonb_build_object('claimed', false, 'conflict', true, 'assigned_user_id', v_assigned);
  end if;
  update conversations set mode = 'human', assigned_user_id = auth.uid(), handoff_at = now() where id = p_conversation_id;
  if public.sticky_enabled(v_ws) then
    perform public.link_contact_operator(p_conversation_id, auth.uid());
  end if;
  insert into audit_logs (workspace_id, actor_user_id, action, entity, entity_id, details)
    values (v_ws, auth.uid(), 'conversation.claimed', 'conversation', p_conversation_id::text,
            jsonb_build_object('force', p_force, 'previous_assigned_user_id', v_assigned));
  return jsonb_build_object('claimed', true, 'conflict', false, 'assigned_user_id', auth.uid());
end $$;

-- Roteamento: o vínculo do cliente vale em todos os modos; depois, a regra do modo.
create or replace function public.route_conversation(p_conversation_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_phone text;
  v_current uuid;
  v_dept uuid;
  v_mode text;
  v_user uuid;
begin
  select workspace_id, regexp_replace(contact_phone, '[^0-9]', '', 'g'), assigned_user_id, department_id
    into v_ws, v_phone, v_current, v_dept from conversations where id = p_conversation_id;
  if v_ws is null then return null; end if;
  select assignment_mode into v_mode from workspace_routing where workspace_id = v_ws;
  v_mode := coalesce(v_mode, 'shared');
  -- 1. Cliente com operador (carteira ou vínculo ao assumir), desde que ainda seja da equipe e do setor da conversa.
  select ca.user_id into v_user from contact_assignments ca
    join workspace_members m on m.workspace_id = ca.workspace_id and m.user_id = ca.user_id
    where ca.workspace_id = v_ws and ca.phone = v_phone
      and (v_dept is null or exists (select 1 from department_members dm where dm.department_id = v_dept and dm.user_id = ca.user_id));
  -- 2. Regra do modo.
  if v_user is null and v_mode = 'round_robin' then
    if v_current is not null and exists (select 1 from workspace_members where workspace_id = v_ws and user_id = v_current)
       and (v_dept is null or exists (select 1 from department_members where department_id = v_dept and user_id = v_current)) then
      return v_current;
    end if;
    select m.user_id into v_user from workspace_members m
      left join conversations c on c.workspace_id = v_ws and c.assigned_user_id = m.user_id and c.mode = 'human'
      where m.workspace_id = v_ws and not m.is_support
        and (v_dept is null or exists (select 1 from department_members dm where dm.department_id = v_dept and dm.user_id = m.user_id))
      group by m.user_id, m.created_at
      order by count(c.id), m.created_at
      limit 1;
  end if;
  if v_user is not null then
    update conversations set assigned_user_id = v_user where id = p_conversation_id;
  end if;
  return v_user;
end $$;

-- Transferir para um operador também vincula o cliente a ele.
create or replace function public.transfer_conversation(
  p_conversation_id uuid, p_user_id uuid default null, p_department_id uuid default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_assigned uuid;
  v_dept uuid;
  v_from text;
  v_to text;
  v_dept_name text;
  v_routed uuid;
  v_text text;
begin
  select workspace_id, assigned_user_id, department_id into v_ws, v_assigned, v_dept from conversations where id = p_conversation_id;
  if v_ws is null or not public.can_view_conversation(v_ws, v_assigned, v_dept) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null and p_department_id is null then
    raise exception 'transfer_target_required' using errcode = '22023';
  end if;
  if p_user_id is not null and not exists (select 1 from workspace_members where workspace_id = v_ws and user_id = p_user_id) then
    raise exception 'user_not_member' using errcode = '22023';
  end if;
  if p_department_id is not null then
    select name into v_dept_name from departments where id = p_department_id and workspace_id = v_ws;
    if v_dept_name is null then
      raise exception 'department_not_found' using errcode = '22023';
    end if;
  end if;

  update conversations set
    mode = 'human',
    assigned_user_id = p_user_id,
    department_id = coalesce(p_department_id, department_id),
    handoff_at = coalesce(handoff_at, now())
  where id = p_conversation_id;
  if p_user_id is null then
    v_routed := public.route_conversation(p_conversation_id);
  elsif public.sticky_enabled(v_ws) then
    perform public.link_contact_operator(p_conversation_id, p_user_id);
  end if;

  v_from := public.user_label(auth.uid());
  v_to := public.user_label(coalesce(p_user_id, v_routed));
  v_text := 'Transferida por ' || coalesce(v_from, 'operador') || ' para '
    || coalesce(v_to, '')
    || case when v_dept_name is not null and v_to is not null then ' (setor ' || v_dept_name || ')'
            when v_dept_name is not null then 'o setor ' || v_dept_name else '' end
    || case when nullif(trim(coalesce(p_note, '')), '') is not null then ': ' || left(trim(p_note), 500) else '' end;
  insert into messages (workspace_id, conversation_id, direction, sender, type, content, status, agent_user_id, metadata)
    values (v_ws, p_conversation_id, 'outbound', 'system', 'text', v_text, 'sent', auth.uid(),
            jsonb_build_object('event', 'transfer', 'to_user_id', coalesce(p_user_id, v_routed), 'to_department_id', p_department_id));
  insert into audit_logs (workspace_id, actor_user_id, action, entity, entity_id, details)
    values (v_ws, auth.uid(), 'conversation.transferred', 'conversation', p_conversation_id::text,
            jsonb_build_object('from_user_id', v_assigned, 'to_user_id', coalesce(p_user_id, v_routed),
                               'from_department_id', v_dept, 'to_department_id', p_department_id,
                               'note', nullif(trim(coalesce(p_note, '')), '')));
  return jsonb_build_object('assigned_user_id', coalesce(p_user_id, v_routed), 'department_id', coalesce(p_department_id, v_dept));
end $$;
