#!/usr/bin/env bash
# Prova que o backup restaura: decifra o arquivo, restaura o banco num Postgres descartável e compara com o manifesto.
# Uso: bash scripts/backup-restore-test.sh [/var/backups/callia/callia-AAAA-MM-DD_HHMM.tar.enc]
set -euo pipefail
KEY_FILE=/root/.callia-backup-key
file="${1:-$(ls -1t /var/backups/callia/callia-*.tar.enc | head -1)}"
work=$(mktemp -d /var/tmp/callia-restore.XXXXXX)
name=callia-restore-test-$$
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

echo "arquivo: $file"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_FILE" -in "$file" | tar xf - -C "$work"
(cd "$work" && sha256sum -c --quiet <(grep -E '\./' MANIFEST.txt)) && echo "integridade: ok (sha256)"

docker run -d --name "$name" -e POSTGRES_PASSWORD=restore --memory 1g supabase/postgres:17.6.1.136 >/dev/null
until docker exec "$name" pg_isready -U postgres -h localhost >/dev/null 2>&1; do sleep 2; done
sleep 4
docker cp "$work/callia-db.dump" "$name:/tmp/callia-db.dump"
# Erros de objetos que a imagem já traz (extensões, papéis) são esperados; o que importa são os dados.
docker exec "$name" pg_restore -U supabase_admin -d postgres --no-owner --clean --if-exists /tmp/callia-db.dump >/dev/null 2>&1 || true

restored=$(docker exec "$name" psql -U supabase_admin -d postgres -tAc "select 'workspaces=' || count(*) from public.workspaces; select 'messages=' || count(*) from public.messages; select 'media_assets=' || count(*) from public.media_assets; select 'auth_users=' || count(*) from auth.users;")
expected=$(grep -E '^(workspaces|messages|media_assets|auth_users)=' "$work/MANIFEST.txt")
echo "esperado:   $(echo $expected)"
echo "restaurado: $(echo $restored)"
[[ "$(echo $expected)" == "$(echo $restored)" ]] && echo "RESTAURAÇÃO OK" || { echo "DIVERGÊNCIA NA RESTAURAÇÃO" >&2; exit 1; }
for f in evolution-db.dump evolution-instances.tgz storage.tgz config.tgz; do printf '%-24s %s\n' "$f" "$(du -h "$work/$f" | cut -f1)"; done
