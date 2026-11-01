-- Devolução automática ao bot por inatividade. Por empresa (agent_configs.auto_return_minutes, null = desligado;
-- padrão 30 min): conversa em modo humano sem mensagem de nenhum dos lados há N minutos volta ao bot, para que a
-- próxima mensagem do cliente (amanhã, de madrugada) seja respondida na hora.
-- Proteções: só se a equipe chegou a responder neste atendimento (evita o pingue-pongue quando a IA transferiu por
-- não saber e ninguém respondeu) e nunca para conversas encerradas. Nada é enviado ao cliente: fica uma mensagem de
-- sistema e, se a última mensagem é do cliente sem resposta, a function auto-return pede à IA que responda.

alter table public.agent_configs
  add column auto_return_minutes integer default 30
  check (auto_return_minutes is null or auto_return_minutes between 5 and 1440);

create or replace function public.auto_return_idle_conversations(p_limit integer default 50)
returns table (conversation_id uuid, workspace_id uuid, idle_minutes integer, pending_message_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_last record;
begin
  for r in
    select c.id, c.workspace_id, a.auto_return_minutes,
           floor(extract(epoch from (now() - c.last_message_at)) / 60)::integer as idle
    from conversations c
    join agent_configs a on a.workspace_id = c.workspace_id
    join workspaces w on w.id = c.workspace_id and w.status in ('trial', 'active')
    where c.mode = 'human'
      and c.channel = 'whatsapp'
      and a.enabled
      and a.auto_return_minutes is not null
      and c.last_message_at is not null
      and c.last_message_at < now() - make_interval(mins => a.auto_return_minutes)
      -- A equipe respondeu neste atendimento (pela inbox ou pelo celular).
      and exists (
        select 1 from messages m
        where m.conversation_id = c.id and m.sender = 'agent'
          and m.created_at >= coalesce(c.handoff_at, c.created_at) - interval '1 minute'
      )
    order by c.last_message_at
    limit p_limit
  loop
    update conversations set mode = 'bot' where id = r.id and mode = 'human';
    if not found then continue; end if;
    insert into messages (workspace_id, conversation_id, direction, sender, type, content, status, metadata)
      values (r.workspace_id, r.id, 'outbound', 'system', 'text',
              'Devolvida ao bot: sem mensagens há ' || r.idle || ' min (limite de ' || r.auto_return_minutes || ' min).',
              'sent', jsonb_build_object('event', 'auto_return', 'idle_minutes', r.idle));
    insert into audit_logs (workspace_id, actor_type, action, entity, entity_id, details)
      values (r.workspace_id, 'system', 'conversation.auto_returned', 'conversation', r.id::text,
              jsonb_build_object('idle_minutes', r.idle, 'limit_minutes', r.auto_return_minutes));
    -- Última mensagem do cliente sem resposta: quem chama responde por ela (process-message).
    select m.id, m.direction, m.sender into v_last from messages m
      where m.conversation_id = r.id and m.sender <> 'system' order by m.seq desc limit 1;
    conversation_id := r.id;
    workspace_id := r.workspace_id;
    idle_minutes := r.idle;
    pending_message_id := case when v_last.direction = 'inbound' and v_last.sender = 'customer' then v_last.id else null end;
    return next;
  end loop;
end $$;
revoke execute on function public.auto_return_idle_conversations(integer) from public, anon, authenticated;
grant execute on function public.auto_return_idle_conversations(integer) to service_role;
