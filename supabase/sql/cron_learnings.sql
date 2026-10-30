-- Agenda os Aprendizados do atendimento (function learnings) todo dia às 04:00 de Brasília (07:00 UTC; o pg_cron usa UTC).
-- Rodar UMA vez no banco do Callia, depois de publicar as functions e de criar o segredo
-- callia_internal_function_secret no Vault (ver cron_webhook_dispatcher.sql). Requer pg_cron e pg_net.
-- O edge-runtime precisa de learnings em NO_VERIFY_JWT_FUNCTIONS (autentica pelo segredo interno;
-- as ações do painel validam a sessão do usuário dentro da function).
select cron.schedule(
  'callia-learnings',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/learnings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-callia-internal', (select decrypted_secret from vault.decrypted_secrets where name = 'callia_internal_function_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
