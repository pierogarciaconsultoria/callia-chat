-- Segredos da plataforma (ex.: credenciais do Mercado Pago) gravados cifrados pelo console central.
-- Ninguém lê pelo cliente: sem políticas para authenticated; só o service_role (functions) acessa.
create table public.platform_secrets (
  key text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  ciphertext text not null,
  -- Últimos caracteres, para o console mostrar "configurado (…1234)" sem expor o valor.
  hint text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.platform_secrets enable row level security;
revoke all on public.platform_secrets from public, anon, authenticated;
grant all on public.platform_secrets to service_role;
