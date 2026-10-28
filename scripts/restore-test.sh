#!/usr/bin/env bash
# Prova do backup: abre o último pacote, restaura o banco do Callia num Postgres descartável e compara as contagens
# com o banco em produção. Não toca em nada que está no ar. Uso: bash scripts/restore-test.sh [arquivo.tar.gz.gpg]
set -euo pipefail
DEST=/var/backups/callia
KEYFILE=/root/.callia-backup.key
PKG="${1:-$(ls -1t "$DEST"/callia-*.tar.gz.gpg | head -1)}"
WORK="$(mktemp -d /tmp/callia-restore.XXXXXX)"
NAME=callia-restore-$$
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

gpg --batch --quiet --passphrase-file "$KEYFILE" -d "$PKG" | tar -C "$WORK" -xzf -
echo "pacote: $PKG"; head -2 "$WORK/MANIFEST.txt"

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test --memory 1g supabase/postgres:17.6.1.136 >/dev/null
until docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1; do sleep 2; done
sleep 3
# Extensões e papéis que o dump referencia já existem na imagem Supabase; erros de objetos pré-existentes são esperados.
docker exec -i "$NAME" pg_restore -U supabase_admin -d postgres --no-owner --no-privileges < "$WORK/callia-db.dump" 2> "$WORK/restore.err" || echo "pg_restore: $(grep -c "^pg_restore: error" "$WORK/restore.err") erro(s) ignorados (objetos que já existem na imagem)"

count() { docker exec "$1" psql -U "$2" -d postgres -At -c "select (select count(*) from public.workspaces)||'/'||(select count(*) from public.messages)||'/'||(select count(*) from public.knowledge_chunks)"; }
LIVE="$(count callia-db postgres)"
RESTORED="$(count "$NAME" supabase_admin)"
echo "produção  (workspaces/mensagens/trechos): $LIVE"
echo "restaurado(workspaces/mensagens/trechos): $RESTORED"
[[ -s "$WORK/storage.tar.gz" ]] && echo "storage: $(tar -tzf "$WORK/storage.tar.gz" | grep -vc '/$') arquivos no pacote"
if [[ "$LIVE" == "$RESTORED" ]]; then echo "RESTAURAÇÃO OK"; else echo "DIVERGÊNCIA (normal se houve mensagens novas desde o backup)"; fi
