-- Nome de exibição dos operadores. Fica em auth.users.raw_user_meta_data->>'full_name' (mesma chave que o login
-- com Google preenche). O painel mostra o nome e cai no trecho do e-mail antes do @ quando não há nome.

-- Rótulo de um usuário para mensagens de sistema e listas: nome, senão a parte local do e-mail.
create or replace function public.user_label(p_user_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ''),
    split_part(u.email, '@', 1)
  ) from auth.users u where u.id = p_user_id
$$;
revoke execute on function public.user_label(uuid) from public, anon;
grant execute on function public.user_label(uuid) to authenticated, service_role;

drop function public.list_workspace_members(uuid);
create function public.list_workspace_members(p_workspace_id uuid)
returns table (user_id uuid, email text, display_name text, role public.workspace_role, is_support boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text,
    nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ''),
    m.role, m.is_support, m.created_at
  from workspace_members m join auth.users u on u.id = m.user_id
  where m.workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
  order by m.created_at;
$$;
revoke execute on function public.list_workspace_members(uuid) from public, anon;
grant execute on function public.list_workspace_members(uuid) to authenticated;

-- Mensagem de sistema da transferência passa a usar o nome.
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
  -- Só setor: o rodízio (se ligado) já escolhe alguém do setor.
  if p_user_id is null then
    v_routed := public.route_conversation(p_conversation_id);
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
