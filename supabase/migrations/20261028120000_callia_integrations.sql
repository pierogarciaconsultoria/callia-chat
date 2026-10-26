-- Integrações simplificadas: Hospedin (PMS), link de reservas e estado de cada conector.

alter table public.workspace_connectors drop constraint workspace_connectors_kind_check;
alter table public.workspace_connectors add constraint workspace_connectors_kind_check
  check (kind in ('hbook', 'hospedin', 'booking_link'));

alter table public.workspace_connectors
  -- Credenciais cifradas (AES-GCM, CALLIA_ENCRYPTION_KEY). Nunca chegam ao painel.
  add column secret_ciphertext text,
  add column status text not null default 'connected' check (status in ('connected', 'error', 'disconnected', 'pending')),
  add column summary text,
  add column last_checked_at timestamptz,
  add column last_error text;

-- O painel lê tudo menos o segredo; gravação só pela function integrations.
drop policy if exists connectors_admin on public.workspace_connectors;
create policy connectors_select on public.workspace_connectors for select to authenticated
  using (public.is_workspace_admin(workspace_id));
revoke all on public.workspace_connectors from authenticated;
grant select (id, workspace_id, kind, enabled, config, status, summary, last_checked_at, last_error, created_at, updated_at)
  on public.workspace_connectors to authenticated;
