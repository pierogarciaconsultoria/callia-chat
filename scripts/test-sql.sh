#!/usr/bin/env bash
# Aplica as migrations num Postgres descartável (imagem Supabase) e roda o teste de RLS. Nada fica rodando.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME=callia-sqltest-$$
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test --memory 1g supabase/postgres:17.6.1.136 >/dev/null
until docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1; do sleep 2; done
sleep 4
run() { docker exec -i "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
# O schema storage é criado pelo serviço de storage; aqui basta um esboço.
run <<'SQL'
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
-- Colunas que o GoTrue acrescenta em auth.users (a imagem crua traz a versão antiga).
alter table auth.users add column if not exists email_confirmed_at timestamptz, add column if not exists banned_until timestamptz,
  add column if not exists invited_at timestamptz, add column if not exists last_sign_in_at timestamptz;
SQL
for f in "$ROOT"/supabase/migrations/*.sql; do echo "migration: $(basename "$f")"; run -1 < "$f"; done
for t in "$ROOT"/supabase/tests/*.sql; do echo "teste: $(basename "$t")"; run < "$t"; done
