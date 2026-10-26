-- Agenda o webhook-dispatcher a cada minuto (retentativas de webhooks de saída).
-- Rodar UMA vez no banco do Callia, depois de publicar as functions. Requer pg_cron e pg_net.
-- Substitua os dois valores abaixo; o segredo fica no Vault, não no texto do job.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('<INTERNAL_FUNCTION_SECRET>', 'callia_internal_function_secret');

select cron.schedule(
  'callia-webhook-dispatcher',
  '* * * * *',
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/webhook-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-callia-internal', (select decrypted_secret from vault.decrypted_secrets where name = 'callia_internal_function_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
