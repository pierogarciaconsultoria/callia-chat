#!/usr/bin/env bash
# Teste ponta a ponta descartável: Postgres (imagem Supabase) + PostgREST + edge-runtime com as functions reais
# + container "mock" (gateway, Evolution falsa, OpenAI falsa, receptor de webhooks). Tudo é removido no final.
# Uso: DENO=/caminho/deno bash scripts/e2e/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DENO="${DENO:-$(command -v deno)}"
NET=callia-e2e
PG_IMAGE=supabase/postgres:17.6.1.136
REST_IMAGE=postgrest/postgrest:v14.17
EDGE_IMAGE=supabase/edge-runtime:v1.76.2
AUTH_IMAGE=supabase/gotrue:v2.196.0
STORAGE_IMAGE=supabase/storage-api:v1.74.0
JWT_SECRET="e2e-jwt-secret-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
MASTER_KEY="e2e-master-key-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
PG_PASS="e2e$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"

cleanup() {
  docker rm -f callia-e2e-db callia-e2e-rest callia-e2e-auth callia-e2e-storage callia-e2e-functions callia-e2e-mock >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null

echo "▶ Banco"
docker run -d --name callia-e2e-db --network "$NET" --network-alias db -e POSTGRES_PASSWORD="$PG_PASS" --memory 1g "$PG_IMAGE" >/dev/null
until docker exec callia-e2e-db pg_isready -U postgres -h localhost >/dev/null 2>&1; do sleep 2; done
sleep 4
psql_admin() { docker exec -i callia-e2e-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_admin <<SQL
alter role authenticator with password '$PG_PASS';
alter role supabase_auth_admin with password '$PG_PASS';
alter role supabase_storage_admin with password '$PG_PASS';
SQL
# GoTrue cria/atualiza o schema auth antes das migrations do Callia (como no stack real).
docker run -d --name callia-e2e-auth --network "$NET" --network-alias auth \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://localhost:54320/auth/v1 \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PG_PASS@db:5432/postgres" \
  -e GOTRUE_SITE_URL=http://localhost:54320 -e GOTRUE_JWT_SECRET="$JWT_SECRET" -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_DISABLE_SIGNUP=true -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true "$AUTH_IMAGE" >/dev/null
until docker exec callia-e2e-db psql -U postgres -tAc "select 1 from auth.schema_migrations where version = '20260625000000'" 2>/dev/null | grep -q 1; do sleep 2; done
sleep 3
# Storage cria o schema storage (buckets, objects) antes das migrations do Callia.
SERVICE_KEY="$("$DENO" run --quiet "$ROOT/scripts/e2e/jwt.ts" "$JWT_SECRET" service_role)"
ANON_KEY="$("$DENO" run --quiet "$ROOT/scripts/e2e/jwt.ts" "$JWT_SECRET" anon)"
docker run -d --name callia-e2e-storage --network "$NET" --network-alias storage \
  -e ANON_KEY="$ANON_KEY" -e SERVICE_KEY="$SERVICE_KEY" -e AUTH_JWT_SECRET="$JWT_SECRET" -e POSTGREST_URL=http://rest:3000 \
  -e DATABASE_URL="postgres://supabase_storage_admin:$PG_PASS@db:5432/postgres" -e STORAGE_PUBLIC_URL=http://mock:54320 \
  -e REQUEST_ALLOW_X_FORWARDED_PATH=true -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
  -e TENANT_ID=stub -e REGION=stub -e GLOBAL_S3_BUCKET=stub -e ENABLE_IMAGE_TRANSFORMATION=false "$STORAGE_IMAGE" >/dev/null
until docker exec callia-e2e-db psql -U postgres -tAc "select 1 from storage.buckets limit 0" >/dev/null 2>&1 && \
      docker exec callia-e2e-db psql -U postgres -tAc "select to_regprocedure('storage.foldername(text)') is not null" 2>/dev/null | grep -q t; do sleep 2; done
sleep 3
for f in "$ROOT"/supabase/migrations/*.sql; do psql_admin -1 < "$f"; done
echo "  migrations aplicadas"

echo "▶ PostgREST, mock e edge-runtime"
docker run -d --name callia-e2e-rest --network "$NET" --network-alias rest \
  -e PGRST_DB_URI="postgres://authenticator:$PG_PASS@db:5432/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" "$REST_IMAGE" >/dev/null

docker run -d --name callia-e2e-mock --network "$NET" --network-alias mock -p 127.0.0.1:54320:54320 -p 127.0.0.1:54321:54321 \
  -v "$DENO":/opt/deno:ro -v "$ROOT/scripts/e2e":/e2e:ro --entrypoint /opt/deno "$EDGE_IMAGE" \
  run -A /e2e/mock.ts 0.0.0.0 http://rest:3000 http://functions:9000 http://auth:9999 http://storage:5000 >/dev/null

docker run -d --name callia-e2e-functions --network "$NET" --network-alias functions \
  -v "$ROOT/supabase/functions":/home/deno/functions:ro -v "$ROOT/scripts/e2e/main":/home/deno/main:ro \
  -e SUPABASE_URL=http://mock:54320 -e SUPABASE_ANON_KEY="$ANON_KEY" -e SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" \
  -e INTERNAL_FUNCTION_SECRET=e2e-internal-secret -e CALLIA_ENCRYPTION_KEY="$MASTER_KEY" \
  -e EVOLUTION_BASE_URL=http://mock:54321/evo -e EVOLUTION_API_KEY=evo-test-key \
  -e AI_COMPAT_BASE_URL=http://mock:54321/openai -e AI_COMPAT_API_KEY=ai-test-key -e AI_DEFAULT_MODEL=fake-model \
  -e AI_SETUP_MODEL=fake-setup-model -e INSTAGRAM_BASE_URL=http://mock:54322/ig -e CALLIA_ALLOW_PRIVATE_URLS=true \
  -e HOSPEDIN_BASE_URL=http://mock:54322/hospedin -e SUPABASE_PUBLIC_URL=http://mock:54320 \
  -e GDRIVE_EMBED_BASE_URL=http://mock:54322/gdrive -e GDRIVE_THUMB_BASE_URL=http://mock:54322/gdrive \
  "$EDGE_IMAGE" start --main-service /home/deno/main -p 9000 >/dev/null

until curl -fsS http://127.0.0.1:54321/__calls >/dev/null 2>&1; do sleep 1; done
until curl -fsS -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" "http://127.0.0.1:54320/rest/v1/workspaces?limit=1" >/dev/null 2>&1; do sleep 1; done
# Aquece as functions (o primeiro acesso baixa os pacotes npm).
for fn in whatsapp-webhook process-message public-api; do
  curl -s -o /dev/null -m 120 -X POST "http://127.0.0.1:54320/functions/v1/$fn" -d '{}' || true
done
echo "  serviços prontos"

echo "▶ Cenário"
set +e
E2E_GATEWAY=http://127.0.0.1:54320 E2E_MOCK=http://127.0.0.1:54321 E2E_MOCK_FROM_CONTAINER=http://mock:54321 \
E2E_SERVICE_KEY="$SERVICE_KEY" E2E_ANON_KEY="$ANON_KEY" E2E_MASTER_KEY="$MASTER_KEY" \
  "$DENO" run --quiet --allow-net --allow-env "$ROOT/scripts/e2e/scenario.ts"
status=$?
set -e
if [ $status -ne 0 ]; then
  echo "── logs do edge-runtime (últimas 60 linhas) ──"
  docker logs callia-e2e-functions 2>&1 | grep -v "serving the request" | tail -60
fi
exit $status
