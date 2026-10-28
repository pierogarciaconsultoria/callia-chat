#!/usr/bin/env bash
# Cópia de segurança do Callia: banco (Supabase), banco da Evolution, arquivos (storage), sessões do WhatsApp e
# segredos (.env). Pacote cifrado (gpg, senha em /root/.callia-backup.key) em /var/backups/callia e, se o rclone
# tiver o remoto "callia-backup", também fora do servidor. Retenção: 14 dias local, 60 dias remoto.
# Uso: bash scripts/backup.sh            (cron diário em /etc/cron.d/callia-backup)
#      bash scripts/restore-test.sh      (restaura o último pacote num Postgres descartável e confere)
set -euo pipefail
STACK=/opt/supabase-callia
EVO=/opt/callia-evolution
DEST=/var/backups/callia
KEYFILE=/root/.callia-backup.key
REMOTE=callia-backup:callia-backups
STAMP="$(date -u +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d /tmp/callia-backup.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$DEST"
umask 077

if [[ ! -s "$KEYFILE" ]]; then
  head -c 48 /dev/urandom | base64 -w0 > "$KEYFILE"
  chmod 600 "$KEYFILE"
  echo "chave de cifragem criada em $KEYFILE — guarde uma cópia fora do servidor; sem ela o backup não abre"
fi

# 1. Bancos (formato custom do pg_dump: restaura com pg_restore).
docker exec callia-db pg_dump -U postgres -Fc --no-owner postgres > "$WORK/callia-db.dump"
docker exec callia-evolution-db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc --no-owner "$POSTGRES_DB"' > "$WORK/evolution-db.dump"

# 2. Arquivos e sessões.
tar -C "$STACK/volumes" -czf "$WORK/storage.tar.gz" storage
docker run --rm -v callia-evolution_instances:/src:ro -v "$WORK":/out alpine:3.20 tar -C /src -czf /out/evolution-instances.tar.gz . 2>/dev/null || true

# 3. Segredos e configuração (ficam só dentro do pacote cifrado).
mkdir -p "$WORK/config/supabase" "$WORK/config/evolution"
cp "$STACK/.env" "$STACK/docker-compose.yml" "$WORK/config/supabase/"
[[ -d "$EVO" ]] && cp "$EVO"/.env "$EVO"/docker-compose.yml "$WORK/config/evolution/" 2>/dev/null || true
cp "$KEYFILE" "$WORK/config/backup.key"

# 4. Pacote cifrado + manifesto.
{
  echo "callia backup $STAMP"
  echo "callia-db: $(docker exec callia-db psql -U postgres -At -c "select count(*)||' workspaces, '||(select count(*) from messages)||' mensagens' from workspaces")"
  ls -l "$WORK" | awk 'NR>1 {print $5, $9}'
} > "$WORK/MANIFEST.txt"
OUT="$DEST/callia-$STAMP.tar.gz.gpg"
tar -C "$WORK" -czf - . | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$KEYFILE" -o "$OUT"
chmod 600 "$OUT"

# 5. Retenção local e cópia remota.
find "$DEST" -name 'callia-*.tar.gz.gpg' -mtime +14 -delete
if rclone listremotes 2>/dev/null | grep -q '^callia-backup:'; then
  rclone copy "$OUT" "$REMOTE/" --s3-no-check-bucket 2>&1 | tail -2
  rclone delete "$REMOTE/" --min-age 60d 2>/dev/null || true
  echo "remoto: ok ($(rclone ls "$REMOTE/" 2>/dev/null | wc -l) pacotes)"
else
  echo "remoto: rclone sem o remoto 'callia-backup' — só cópia local"
fi
echo "backup: $OUT ($(du -h "$OUT" | cut -f1))"
