# Runbook de deploy

O Callia roda em **stack Supabase próprio** (banco, auth, functions). Não publique estas functions no stack de outro sistema:
nomes como `whatsapp-webhook` colidem e os dados deixariam de estar isolados.

## 1. Pré-requisitos

- Stack Supabase self-hosted dedicado (Postgres 15+, com `vector`, `unaccent`, `pg_cron`, `pg_net`) e edge-runtime.
- Evolution API v2 **dedicada ao Callia**, com Postgres e Redis próprios, alcançável pelo edge-runtime e capaz de chamar o webhook.
- DNS apontado para os subdomínios (ex.: `app.` painel, `api.` Supabase, `evolution.` se a Evolution for exposta) e certificados.
- Chave de IA compatível com OpenAI (opcional: sem ela o agente responde só com FAQ e faz handoff).

## 2. Banco

```bash
for f in supabase/migrations/*.sql; do
  docker exec -i <db-do-callia> psql -U postgres -v ON_ERROR_STOP=1 -1 < "$f"
done
```

Confira que existe o bucket `knowledge` e que `conversations` e `messages` estão na publicação `supabase_realtime`.

## 3. Secrets das functions

Preencha conforme [supabase/functions.env.example](supabase/functions.env.example). Gere valores fortes:

```bash
openssl rand -base64 48   # INTERNAL_FUNCTION_SECRET, CALLIA_ENCRYPTION_KEY, API_KEY_PEPPER
```

`CALLIA_ENCRYPTION_KEY` e `API_KEY_PEPPER` **não podem mudar** depois do go-live: trocar invalida os segredos de webhooks e as API keys.

## 4. Functions

Copie `supabase/functions/*` (incluindo `_shared`) para o volume de functions do stack do Callia.
O `_shared` entra no bundle de cada function: ao alterá-lo, republique as que o importam.

No edge-runtime: `NO_VERIFY_JWT_FUNCTIONS=whatsapp-webhook,public-api,process-message,webhook-dispatcher,mcp,pms-sync,billing-webhook,learnings`
(essas autenticam por token próprio, `x-api-key` ou segredo interno; ver `supabase/config.toml`).

## 5. Cron do dispatcher

Edite e rode [supabase/sql/cron_webhook_dispatcher.sql](supabase/sql/cron_webhook_dispatcher.sql). Ele chama o `webhook-dispatcher` a cada minuto
para retentar webhooks de saída (30 s, 2 min, 10 min, 30 min, 1 h, depois 2 h, até `max_attempts`).

## 6. Auth

- Cadastro aberto desligado (`DISABLE_SIGNUP=true`), sem confirmação automática de e-mail.
- Google OAuth opcional: configure o provider no GoTrue e a URL de retorno do painel.
- Usuários novos são criados pelo admin da plataforma; depois o owner do workspace os adiciona em `/team`.

## 7. Frontend

```bash
VITE_SUPABASE_URL=https://api.seudominio.com VITE_SUPABASE_PUBLISHABLE_KEY=<anon> npm run build
```

Sirva `dist/` pelo Nginx com fallback de SPA (`try_files $uri /index.html;`).

## 8. Validação

1. Login → criar workspace → `/whatsapp` → criar instância → ler o QR → status `open`.
2. Mandar "oi" de outro celular → resposta do agente aparece na inbox.
3. `/agent` → "Testar agente" com uma pergunta da FAQ.
4. `/api-keys` → gerar chave → `POST /functions/v1/public-api/messages` para um número de teste.
5. `/webhooks` → criar apontando para um receptor de teste → "Testar" → entrega `success`.
6. Seguir o [PILOT_GO_LIVE_CHECKLIST.md](PILOT_GO_LIVE_CHECKLIST.md).

## MCP

`/functions/v1/mcp` aceita `Authorization: Bearer <access token do usuário>` (funciona em clientes que permitem header manual).
Para o fluxo OAuth de ChatGPT/Claude, habilite o servidor OAuth 2.1 do Supabase Auth; a descoberta já é publicada em
`/functions/v1/mcp/.well-known/oauth-protected-resource`.

## Produção (callia.sistemalexis.com.br)

| Peça | Onde |
|---|---|
| Painel | `/var/www/callia/current` → `releases/<data>` (Nginx: `/etc/nginx/sites-available/callia.sistemalexis.com.br`) |
| Supabase | `/opt/supabase-callia` (containers `callia-*`, Envoy em `127.0.0.1:8300`, pooler `127.0.0.1:5462/6573`) |
| Segredos | `/opt/supabase-callia/.env` (stack) e `/opt/supabase-callia/functions.env` (functions) |
| Evolution | `/opt/callia-evolution` (`callia-evolution`, sem porta publicada; rede `callia_default`) |
| Cron | `callia-webhook-dispatcher` (1 min), `callia-pms-sync` (15 min, [supabase/sql/cron_pms_sync.sql](supabase/sql/cron_pms_sync.sql)) e `callia-learnings` (diário 04:00 BRT, [supabase/sql/cron_learnings.sql](supabase/sql/cron_learnings.sql)) em `cron.job` do banco `callia-db` |
| Certificado | Let's Encrypt via Certbot (renovação automática) |

- Redeploy: `bash scripts/deploy.sh` (ou `frontend` / `functions`).
- Migration nova: `docker exec -i callia-db psql -U postgres -v ON_ERROR_STOP=1 -1 < supabase/migrations/<arquivo>.sql`
  e depois `docker exec callia-db psql -U postgres -c "notify pgrst, 'reload schema'"`.
- Mudou `functions.env`: `cd /opt/supabase-callia && docker compose up -d functions`.
- Rollback do painel: `ln -sfn /var/www/callia/releases/<anterior> /var/www/callia/current`.
- Clientes e usuários: pelo console central `/admin` (criar cliente convida o dono por e-mail; o dono adiciona a equipe em `/team`).
- Primeiro admin da plataforma (só uma vez):
  `docker exec callia-db psql -U postgres -c "insert into user_roles(user_id, role) select id, 'platform_admin' from auth.users where email = '<e-mail>'"`.

### Trocar o domínio público

`sudo bash scripts/switch-domain.sh www.novo.dominio novo.dominio` depois que o DNS dos dois apontar para o servidor.
O script cria o site no nginx, emite o certificado, faz o painel do domínio antigo redirecionar para o novo (a API continua
no antigo: webhooks da Evolution, Mercado Pago e chaves de API não mudam), troca `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`,
`SUPABASE_PUBLIC_URL`, `FUNCTIONS_PUBLIC_URL`, `PUBLIC_SITE_URL` e `PANEL_URL`, recria `auth`, `storage`, `functions`,
`api-gw` e `studio`, e recompila o painel. `API_EXTERNAL_URL` fica no domínio antigo de propósito (issuer dos JWTs).
Quem estava logado no domínio antigo entra de novo no novo. Backups em `.env.bak-<data>` e `<site>.bak-<data>`.

## Backup e restauração

`scripts/backup.sh` gera, por execução, um único arquivo cifrado (AES-256) em `/var/backups/callia/` com:
banco do Callia (inclui usuários e storage), banco e sessões da Evolution (evita ler o QR de novo),
arquivos do storage (fotos e documentos) e configuração/segredos do stack. Retenção: 14 dias + semanais por 8 semanas.

```bash
bash scripts/backup.sh --install        # instala /usr/local/sbin/callia-backup, cria a chave e o cron das 03:30
/usr/local/sbin/callia-backup           # backup manual
bash scripts/backup-restore-test.sh     # restaura o último num Postgres descartável e compara com o manifesto
```

- A chave fica em `/root/.callia-backup-key`. **Guarde uma cópia fora do servidor**: sem ela o backup não abre.
- Cópia externa: crie `/etc/callia-backup/offsite.conf` com `RCLONE_REMOTE=destino:pasta` (rclone configurado).
- Restaurar em produção: decifrar com `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/.callia-backup-key`,
  `pg_restore` de `callia-db.dump` no `callia-db`, extrair `storage.tgz` em `/opt/supabase-callia/volumes/`.

## Gateway (Envoy) e webhook do Mercado Pago

Em `/opt/supabase-callia/volumes/api/envoy/lds.template.yaml`, o `http_connection_manager` precisa de
`preserve_external_request_id: true`. O Mercado Pago inclui o cabeçalho `x-request-id` no cálculo da `x-signature`;
sem essa linha o Envoy troca o cabeçalho e `billing-webhook` rejeita toda notificação (401). Depois de mudar,
`docker restart callia-envoy`. `billing-webhook` também precisa estar em `NO_VERIFY_JWT_FUNCTIONS`
(`docker-compose.callia.yml`), e o serviço `functions` só deve ser recriado com `docker compose up -d functions`
sem `-f` (o `COMPOSE_FILE` do `.env` inclui `docker-compose.localonly.yml`, que mapeia a porta 8300).
