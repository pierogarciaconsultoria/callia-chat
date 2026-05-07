-- Phase 3 - WhatsApp instances and default management

alter table public.whatsapp_instances
  drop constraint if exists whatsapp_instances_instance_name_key;

create unique index if not exists uniq_whatsapp_instance_name_per_workspace
  on public.whatsapp_instances(workspace_id, instance_name);

create or replace function public.set_default_whatsapp_instance(
  p_workspace_id uuid,
  p_instance_id uuid
)
returns public.whatsapp_instances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance public.whatsapp_instances;
begin
  if not public.is_workspace_admin(p_workspace_id, auth.uid()) then
    raise exception 'forbidden';
  end if;

  update public.whatsapp_instances
  set is_default = false
  where workspace_id = p_workspace_id
    and id <> p_instance_id
    and is_default = true;

  update public.whatsapp_instances
  set is_default = true
  where workspace_id = p_workspace_id
    and id = p_instance_id
  returning * into v_instance;

  if v_instance.id is null then
    raise exception 'instance_not_found';
  end if;

  return v_instance;
end;
$$;

grant execute on function public.set_default_whatsapp_instance(uuid, uuid) to authenticated;

create or replace function public.rotate_whatsapp_webhook_token(
  p_workspace_id uuid,
  p_instance_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.is_workspace_admin(p_workspace_id, auth.uid()) then
    raise exception 'forbidden';
  end if;

  update public.whatsapp_instances
  set webhook_token = encode(gen_random_bytes(24), 'hex')
  where workspace_id = p_workspace_id
    and id = p_instance_id
  returning webhook_token into v_token;

  if v_token is null then
    raise exception 'instance_not_found';
  end if;

  return v_token;
end;
$$;

grant execute on function public.rotate_whatsapp_webhook_token(uuid, uuid) to authenticated;
