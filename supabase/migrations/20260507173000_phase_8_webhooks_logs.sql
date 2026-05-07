alter table public.webhooks
  add column name text not null default 'Webhook',
  add column description text,
  add column headers jsonb not null default '{}'::jsonb,
  add column updated_at timestamptz not null default now();

create trigger trg_webhooks_updated before update on public.webhooks
  for each row execute function public.set_updated_at();

alter table public.webhook_deliveries
  add column delivery_status text not null default 'pending',
  add column retry_count int not null default 0,
  add column webhook_url text,
  add column request_headers jsonb not null default '{}'::jsonb,
  add column response_headers jsonb,
  add column last_attempt_at timestamptz;

update public.webhook_deliveries
set
  delivery_status = case when delivered_at is not null then 'delivered' when response_status between 200 and 299 then 'delivered' else 'failed' end,
  retry_count = greatest(attempt_number - 1, 0),
  webhook_url = (
    select w.url
    from public.webhooks w
    where w.id = webhook_deliveries.webhook_id
  ),
  last_attempt_at = attempted_at
where webhook_url is null or last_attempt_at is null;

create index idx_webhook_deliveries_status_retry
  on public.webhook_deliveries(delivery_status, next_retry_at, attempted_at desc);

create index idx_webhook_deliveries_workspace_status
  on public.webhook_deliveries(workspace_id, delivery_status, attempted_at desc);

create or replace function public.rotate_webhook_secret(
  p_workspace_id uuid,
  p_webhook_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if not public.is_workspace_admin(p_workspace_id, auth.uid()) then
    raise exception 'forbidden';
  end if;

  update public.webhooks
  set secret = encode(gen_random_bytes(32), 'hex')
  where workspace_id = p_workspace_id
    and id = p_webhook_id
  returning secret into v_secret;

  if v_secret is null then
    raise exception 'webhook_not_found';
  end if;

  return v_secret;
end;
$$;

grant execute on function public.rotate_webhook_secret(uuid, uuid) to authenticated;
