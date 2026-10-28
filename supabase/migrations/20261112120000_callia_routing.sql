-- Distribuição de conversas entre operadores, configurável por empresa:
--   assignment_mode  shared (fila compartilhada) | portfolio (carteira: número do cliente → operador) | round_robin (rodízio)
--   agent_visibility all (atendente vê tudo) | own (atendente vê só as suas e as sem dono; admin vê tudo)
--   sticky_claim     ao assumir, o atendente passa a ser o operador daquele número (só em carteira)

create table public.workspace_routing (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  assignment_mode text not null default 'shared' check (assignment_mode in ('shared', 'portfolio', 'round_robin')),
  agent_visibility text not null default 'all' check (agent_visibility in ('all', 'own')),
  sticky_claim boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.workspace_routing enable row level security;
create policy workspace_routing_select on public.workspace_routing for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy workspace_routing_write on public.workspace_routing for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
revoke all on public.workspace_routing from anon;
grant select, insert, update on public.workspace_routing to authenticated;
grant all on public.workspace_routing to service_role;
create trigger trg_workspace_routing_touch before update on public.workspace_routing
  for each row execute function public.touch_updated_at();

-- Carteira: número do cliente (só dígitos) → operador.
create table public.contact_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  user_id uuid not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, phone)
);
create index contact_assignments_user_idx on public.contact_assignments(workspace_id, user_id);
alter table public.contact_assignments enable row level security;
create policy contact_assignments_select on public.contact_assignments for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy contact_assignments_write on public.contact_assignments for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
revoke all on public.contact_assignments from anon;
grant select, insert, update, delete on public.contact_assignments to authenticated;
grant all on public.contact_assignments to service_role;

-- Visibilidade: admin vê tudo; atendente vê tudo (all) ou só as suas e as sem dono (own).
create or replace function public.can_view_conversation(_workspace_id uuid, _assigned uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_workspace_member(_workspace_id) and (
    public.is_workspace_admin(_workspace_id)
    or _assigned is null
    or _assigned = auth.uid()
    or coalesce((select r.agent_visibility from public.workspace_routing r where r.workspace_id = _workspace_id), 'all') = 'all'
  )
$$;
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (public.can_view_conversation(workspace_id, assigned_user_id));
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = messages.conversation_id and public.can_view_conversation(c.workspace_id, c.assigned_user_id)));

-- Roteia a conversa ao transferir para a equipe (chamada pelas functions). Devolve o operador escolhido ou null.
create or replace function public.route_conversation(p_conversation_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_phone text;
  v_current uuid;
  v_mode text;
  v_user uuid;
begin
  select workspace_id, regexp_replace(contact_phone, '[^0-9]', '', 'g'), assigned_user_id
    into v_ws, v_phone, v_current from conversations where id = p_conversation_id;
  if v_ws is null then return null; end if;
  select assignment_mode into v_mode from workspace_routing where workspace_id = v_ws;
  v_mode := coalesce(v_mode, 'shared');
  if v_mode = 'portfolio' then
    select ca.user_id into v_user from contact_assignments ca
      join workspace_members m on m.workspace_id = ca.workspace_id and m.user_id = ca.user_id
      where ca.workspace_id = v_ws and ca.phone = v_phone;
  elsif v_mode = 'round_robin' then
    -- Quem já atende este cliente continua; senão, o membro com menos conversas em atendimento.
    if v_current is not null and exists (select 1 from workspace_members where workspace_id = v_ws and user_id = v_current) then
      return v_current;
    end if;
    select m.user_id into v_user from workspace_members m
      left join conversations c on c.workspace_id = v_ws and c.assigned_user_id = m.user_id and c.mode = 'human'
      where m.workspace_id = v_ws and not m.is_support
      group by m.user_id, m.created_at
      order by count(c.id), m.created_at
      limit 1;
  end if;
  if v_user is not null then
    update conversations set assigned_user_id = v_user where id = p_conversation_id;
  end if;
  return v_user;
end $$;
revoke execute on function public.route_conversation(uuid) from public, anon, authenticated;
grant execute on function public.route_conversation(uuid) to service_role;

-- Assumir uma conversa: avisa se outro operador já está atendendo (p_force assume mesmo assim, com auditoria).
create or replace function public.claim_conversation(p_conversation_id uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_assigned uuid;
  v_mode text;
  v_phone text;
  v_sticky boolean;
  v_amode text;
begin
  select workspace_id, assigned_user_id, mode, regexp_replace(contact_phone, '[^0-9]', '', 'g')
    into v_ws, v_assigned, v_mode, v_phone from conversations where id = p_conversation_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_mode = 'human' and v_assigned is not null and v_assigned <> auth.uid() and not p_force then
    return jsonb_build_object('claimed', false, 'conflict', true, 'assigned_user_id', v_assigned);
  end if;
  update conversations set mode = 'human', assigned_user_id = auth.uid(), handoff_at = now() where id = p_conversation_id;
  select sticky_claim, assignment_mode into v_sticky, v_amode from workspace_routing where workspace_id = v_ws;
  if coalesce(v_sticky, false) and coalesce(v_amode, 'shared') = 'portfolio' then
    insert into contact_assignments (workspace_id, phone, user_id, created_by) values (v_ws, v_phone, auth.uid(), auth.uid())
      on conflict (workspace_id, phone) do nothing;
  end if;
  insert into audit_logs (workspace_id, actor_user_id, action, entity, entity_id, details)
    values (v_ws, auth.uid(), 'conversation.claimed', 'conversation', p_conversation_id::text,
            jsonb_build_object('force', p_force, 'previous_assigned_user_id', v_assigned));
  return jsonb_build_object('claimed', true, 'conflict', false, 'assigned_user_id', auth.uid());
end $$;
revoke execute on function public.claim_conversation(uuid, boolean) from public, anon;
grant execute on function public.claim_conversation(uuid, boolean) to authenticated;

-- "Ficar com este cliente": o número passa para a carteira de quem chama (qualquer membro).
create or replace function public.claim_contact(p_conversation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_phone text;
begin
  select workspace_id, regexp_replace(contact_phone, '[^0-9]', '', 'g') into v_ws, v_phone from conversations where id = p_conversation_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into contact_assignments (workspace_id, phone, user_id, created_by) values (v_ws, v_phone, auth.uid(), auth.uid())
    on conflict (workspace_id, phone) do update set user_id = excluded.user_id, created_by = excluded.created_by, created_at = now();
  update conversations set assigned_user_id = auth.uid() where id = p_conversation_id and mode = 'human';
end $$;
revoke execute on function public.claim_contact(uuid) from public, anon;
grant execute on function public.claim_contact(uuid) to authenticated;
