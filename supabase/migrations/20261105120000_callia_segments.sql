-- Perfil padrão por segmento (catálogo em supabase/functions/_shared/segments.ts) e CNAE da empresa.
-- segment_id é uma referência lógica ao catálogo do código; o formato é validado aqui e o id no painel/servidor.

alter table public.agent_configs
  add column segment_id text check (segment_id is null or segment_id ~ '^[a-z_]{2,30}$'),
  -- Nulo = segue a política de emoji do segmento.
  add column emoji_policy text check (emoji_policy is null or emoji_policy in ('none', 'light', 'free'));

grant update (segment_id, emoji_policy) on public.agent_configs to authenticated;

-- CNAE principal (só dígitos, 7), vindo da consulta do CNPJ ou digitado.
alter table public.workspace_business_info
  add column cnae_code text check (cnae_code is null or cnae_code ~ '^\d{7}$'),
  add column cnae_description text check (cnae_description is null or length(cnae_description) <= 300);
