-- Agenda a sincronização das reservas do Hospedin (pms-sync) a cada 15 minutos.
-- Rodar UMA vez no banco do Callia, depois de publicar as functions e de criar o segredo
-- callia_internal_function_secret no Vault (ver cron_webhook_dispatcher.sql). Requer pg_cron e pg_net.
-- O edge-runtime precisa de pms-sync em NO_VERIFY_JWT_FUNCTIONS (autentica pelo segredo interno).
select cron.schedule(
  'callia-pms-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/pms-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-callia-internal', (select decrypted_secret from vault.decrypted_secrets where name = 'callia_internal_function_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
