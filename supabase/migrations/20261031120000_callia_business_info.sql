-- Dados cadastrais e de pagamento da empresa (o agente informa ao hóspede para pagar o sinal/reserva).

create table public.workspace_business_info (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  legal_name text,
  cnpj text,
  state_registration text,
  address text,
  phone text,
  email text,
  bank_name text,
  bank_code text,
  agency text,
  account text,
  account_type text check (account_type is null or account_type in ('corrente', 'poupanca', 'pagamento')),
  payee_name text,
  pix_key_type text check (pix_key_type is null or pix_key_type in ('cnpj', 'cpf', 'telefone', 'email', 'aleatoria')),
  pix_key text,
  -- Sinal para garantir a reserva (percentual do total); nulo = a equipe informa.
  deposit_percent numeric(5,2) check (deposit_percent is null or (deposit_percent > 0 and deposit_percent <= 100)),
  payment_instructions text,
  -- O agente só informa os dados de pagamento quando habilitado.
  share_payment_info boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger trg_business_info_touch before update on public.workspace_business_info for each row execute function public.touch_updated_at();

alter table public.workspace_business_info enable row level security;
revoke all on public.workspace_business_info from anon;
create policy business_info_select on public.workspace_business_info for select to authenticated
  using (public.is_workspace_admin(workspace_id));
create policy business_info_write on public.workspace_business_info for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
