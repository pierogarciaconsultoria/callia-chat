-- Setores (departamentos) e transferência de conversas entre operadores e entre setores.
--   departments          setores do workspace (Recepção, Reservas, Financeiro…)
--   department_members   quem atende em cada setor (um membro pode estar em vários)
--   conversations.department_id  setor atual da conversa (null = sem setor)
--   transfer_conversation(...)   transfere para um operador e/ou um setor, registra mensagem de sistema e auditoria
-- Visibilidade "own": conversa sem dono de um setor só aparece para quem é do setor (admin vê tudo).

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index departments_workspace_idx on public.departments(workspace_id, position);
alter table public.departments enable row level security;
create policy departments_select on public.departments for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy departments_write on public.departments for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
revoke all on public.departments from anon;
grant select, insert, update, delete on public.departments to authenticated;
grant all on public.departments to service_role;
create trigger trg_departments_touch before update on public.departments
  for each row execute function public.touch_updated_at();

create table public.department_members (
  department_id uuid not null references public.departments(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (department_id, user_id)
);
create index department_members_user_idx on public.department_members(workspace_id, user_id);
alter table public.department_members enable row level security;
create policy department_members_select on public.department_members for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy department_members_write on public.department_members for all to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id)
    and exists (select 1 from public.workspace_members m where m.workspace_id = department_members.workspace_id and m.user_id = department_members.user_id)
    and exists (select 1 from public.departments d where d.id = department_members.department_id and d.workspace_id = department_members.workspace_id));
revoke all on public.department_members from anon;
grant select, insert, update, delete on public.department_members to authenticated;
grant all on public.department_members to service_role;

alter table public.conversations add column department_id uuid references public.departments(id) on delete set null;
create index conversations_department_idx on public.conversations(workspace_id, department_id);

create or replace function public.is_department_member(_department_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.department_members dm where dm.department_id = _department_id and dm.user_id = auth.uid())
$$;

-- Visibilidade: admin vê tudo; atendente vê as suas; em "all" vê tudo; em "own" vê as sem dono do seu setor ou sem setor.
create or replace function public.can_view_conversation(_workspace_id uuid, _assigned uuid, _department uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_workspace_member(_workspace_id) and (
    public.is_workspace_admin(_workspace_id)
    or _assigned = auth.uid()
    or coalesce((select r.agent_visibility from public.workspace_routing r where r.workspace_id = _workspace_id), 'all') = 'all'
    or (_assigned is null and (_department is null or public.is_department_member(_department)))
  )
$$;
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (public.can_view_conversation(workspace_id, assigned_user_id, department_id));
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = messages.conversation_id and public.can_view_conversation(c.workspace_id, c.assigned_user_id, c.department_id)));
drop function if exists public.can_view_conversation(uuid, uuid);

-- Rodízio respeita o setor da conversa: só distribui entre quem atende nele.
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
  if v_mode = 'portfolio' then
    select ca.user_id into v_user from contact_assignments ca
      join workspace_members m on m.workspace_id = ca.workspace_id and m.user_id = ca.user_id
      where ca.workspace_id = v_ws and ca.phone = v_phone;
  elsif v_mode = 'round_robin' then
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

-- Transferir: para um operador (p_user_id), para um setor (p_department_id) ou os dois. Qualquer membro que veja a
-- conversa pode transferir. Fica uma mensagem de sistema na conversa e um registro na auditoria.
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

  select split_part(email, '@', 1) into v_from from auth.users where id = auth.uid();
  select split_part(email, '@', 1) into v_to from auth.users where id = coalesce(p_user_id, v_routed);
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
revoke execute on function public.transfer_conversation(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.transfer_conversation(uuid, uuid, uuid, text) to authenticated;
