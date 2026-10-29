-- Os privilégios padrão do Postgres do Supabase dão acesso de anon a toda tabela nova; aqui só membros logados usam.
revoke all on public.quick_replies from anon;
