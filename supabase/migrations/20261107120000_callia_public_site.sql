-- Site público (landing e cadastro): planos ativos e configurações que podem ser lidos sem login,
-- e criação do workspace com o que a pessoa informou ao se cadastrar (user_metadata).

create or replace function public.public_site_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'platform_name', coalesce((select value #>> '{}' from platform_settings where key = 'platform_name'), 'Callia Chat'),
    'support_email', (select value #>> '{}' from platform_settings where key = 'support_email'),
    'self_service', coalesce((select (value)::text::boolean from platform_settings where key = 'allow_self_service_workspaces'), false),
    'trial_days', coalesce((select (value #>> '{}')::integer from platform_settings where key = 'trial_days'), 14),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents, 'currency', p.currency,
        'max_instances', p.max_instances, 'max_members', p.max_members, 'max_monthly_messages', p.max_monthly_messages,
        'max_knowledge_sources', p.max_knowledge_sources, 'connectors_enabled', p.connectors_enabled,
        'external_agent_enabled', p.external_agent_enabled
      ) order by p.position, p.name)
      from plans p where p.active), '[]'::jsonb)
  );
$$;
revoke execute on function public.public_site_info() from public;
grant execute on function public.public_site_info() to anon, authenticated;

-- Cadastro: o workspace nasce com os dados do formulário (metadados do usuário: company_name, segment, website, whatsapp)
-- ou com os parâmetros (login social, sem metadados). Idempotente: quem já tem workspace recebe o que já existe.
create or replace function public.create_workspace_from_signup(
  p_name text default null, p_segment text default null, p_website text default null, p_phone text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb;
  v_name text;
  v_segment text;
  v_website text;
  v_phone text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select w.id into v_id from workspaces w
    where exists (select 1 from workspace_members m where m.workspace_id = w.id and m.user_id = auth.uid())
    order by w.created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select coalesce(raw_user_meta_data, '{}'::jsonb) into v_meta from auth.users where id = auth.uid();
  v_name := nullif(trim(coalesce(p_name, v_meta ->> 'company_name', '')), '');
  if v_name is null or length(v_name) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  v_segment := nullif(trim(coalesce(p_segment, v_meta ->> 'segment', '')), '');
  v_website := left(nullif(trim(coalesce(p_website, v_meta ->> 'website', '')), ''), 300);
  v_phone := left(nullif(trim(coalesce(p_phone, v_meta ->> 'whatsapp', '')), ''), 40);

  v_id := public.create_workspace(left(v_name, 120));
  -- Segmento e site do agente: metadado inválido não impede a criação da conta.
  begin
    update agent_configs set segment_id = coalesce(v_segment, segment_id), website_url = coalesce(v_website, website_url)
      where workspace_id = v_id;
  exception when others then null;
  end;
  if v_phone is not null then
    insert into workspace_business_info (workspace_id, phone) values (v_id, v_phone)
      on conflict (workspace_id) do update set phone = excluded.phone;
  end if;
  return v_id;
end $$;
revoke execute on function public.create_workspace_from_signup(text, text, text, text) from public;
grant execute on function public.create_workspace_from_signup(text, text, text, text) to authenticated;
