-- Concede acesso administrativo de contato@pierogarcia.com.br a todos os workspaces.
--
-- O mecanismo é o mesmo que a RLS já usa: linhas em workspace_members.
-- Papel 'admin' passa em is_workspace_admin() (edição de branding, agente,
-- WhatsApp, API keys, webhooks) sem fingir propriedade: ws_delete continua
-- exigindo owner_id. Para poder excluir workspaces, troque 'admin' por 'owner'.
--
-- A identidade é resolvida por e-mail em dois lugares (backfill e trigger),
-- então recriar o usuário no Auth não desprovisiona os workspaces futuros,
-- mas deixaria órfãs as linhas do backfill abaixo.

-- 1) Workspaces existentes.
do $$
declare
  admin_id uuid;
begin
  select id into admin_id from auth.users where email = 'contato@pierogarcia.com.br';

  if admin_id is null then
    raise exception
      'usuario contato@pierogarcia.com.br nao existe em auth.users; crie a conta antes de aplicar esta migration';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  select w.id, admin_id, 'admin'
  from public.workspaces w
  on conflict (workspace_id, user_id) do nothing;
end; $$;

-- 2) Workspaces futuros: mesmo corpo de handle_new_workspace mais o admin de plataforma.
create or replace function public.handle_new_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  admin_id uuid;
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner') on conflict do nothing;

  select id into admin_id from auth.users where email = 'contato@pierogarcia.com.br';

  if admin_id is not null and admin_id is distinct from new.owner_id then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, admin_id, 'admin') on conflict (workspace_id, user_id) do nothing;
  end if;

  insert into public.agent_configs (workspace_id)
  values (new.id) on conflict do nothing;

  insert into public.workspace_branding (workspace_id, display_name)
  values (new.id, new.name) on conflict do nothing;

  return new;
end; $$;
