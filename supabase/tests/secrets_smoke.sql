-- Segredos da plataforma: ninguém lê pelo cliente, nem administrador da plataforma; só o service_role. Termina em ROLLBACK.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
insert into auth.users (id, email, aud, role) values ('eeeeeeee-0000-0000-0000-000000000001', 'root@plataforma.com', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('eeeeeeee-0000-0000-0000-000000000001', 'platform_admin');
insert into public.platform_secrets (key, ciphertext, hint) values ('mercadopago_access_token', 'v1.abc.def', '0264');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$ begin
  perform * from public.platform_secrets;
  raise exception 'authenticated não deveria ler platform_secrets';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.platform_secrets (key, ciphertext) values ('x_y', 'v1.a.b');
  raise exception 'authenticated não deveria gravar platform_secrets';
exception when insufficient_privilege then null;
end $$;
set local role anon;
do $$ begin
  perform * from public.platform_secrets;
  raise exception 'anon não deveria ler platform_secrets';
exception when insufficient_privilege then null;
end $$;

reset role;
set local role service_role;
do $$ begin
  assert (select hint from public.platform_secrets where key = 'mercadopago_access_token') = '0264', 'service_role lê';
end $$;
do $$ begin
  insert into public.platform_secrets (key, ciphertext) values ('Chave Inválida', 'v1.a.b');
  raise exception 'chave fora do padrão deveria ser recusada';
exception when check_violation then null;
end $$;

rollback;
