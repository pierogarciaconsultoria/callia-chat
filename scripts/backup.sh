#!/usr/bin/env bash
# Backup do Callia Chat em produção: banco do Callia, banco e sessões da Evolution, arquivos (fotos/documentos)
# e configuração/segredos do stack. Gera um único arquivo cifrado (AES-256) por execução.
#
# Instalação (uma vez): bash scripts/backup.sh --install
# Execução manual:      /usr/local/sbin/callia-backup
# Restaurar:            ver scripts/backup-restore-test.sh e DEPLOY_RUNBOOK.md ("Backup e restauração")
set -euo pipefail

DEST_ROOT=/var/backups/callia
KEY_FILE=/root/.callia-backup-key
KEEP_DAILY_DAYS=14
KEEP_WEEKLY_DAYS=60
OFFSITE_CONF=/etc/callia-backup/offsite.conf   # opcional: RCLONE_REMOTE=nome:pasta
LOG=/var/log/callia-backup.log

if [[ "${1:-}" == "--install" ]]; then
  install -m 750 "$0" /usr/local/sbin/callia-backup
  if [[ ! -s "$KEY_FILE" ]]; then
    umask 077
    openssl rand -base64 48 > "$KEY_FILE"
    echo "Chave de backup criada em $KEY_FILE — guarde uma cópia fora deste servidor."
  fi
  install -d -m 700 "$DEST_ROOT"
  cat > /etc/cron.d/callia-backup <<'CRON'
# Backup diário do Callia Chat (banco, Evolution, arquivos, configuração), cifrado.
30 3 * * * root /usr/local/sbin/callia-backup >> /var/log/callia-backup.log 2>&1
CRON
  chmod 644 /etc/cron.d/callia-backup
  echo "Instalado: /usr/local/sbin/callia-backup, cron 03:30, destino $DEST_ROOT"
  exit 0
fi

[[ -s "$KEY_FILE" ]] || { echo "Chave $KEY_FILE ausente. Rode com --install." >&2; exit 1; }
stamp=$(date +%Y-%m-%d_%H%M)
work=$(mktemp -d /var/tmp/callia-backup.XXXXXX)
trap 'rm -rf "$work"' EXIT
echo "[$(date -Is)] início $stamp"

# 1. Banco do Callia (inclui auth e storage). Formato custom: restaura por partes.
docker exec callia-db pg_dump -U postgres -d postgres -Fc --no-owner > "$work/callia-db.dump"
# 2. Evolution: banco e sessões do WhatsApp (evita ler o QR de novo após restaurar).
docker exec callia-evolution-db pg_dump -U evolution -d evolution -Fc --no-owner > "$work/evolution-db.dump"
docker exec callia-evolution tar czf - -C /evolution instances > "$work/evolution-instances.tgz"
# 3. Arquivos do storage (fotos, documentos da base de conhecimento).
tar czf "$work/storage.tgz" -C /opt/supabase-callia/volumes storage
# 4. Configuração e segredos do stack (só cifrados dentro do pacote).
tar czf "$work/config.tgz" \
  /opt/supabase-callia/.env /opt/supabase-callia/functions.env \
  /opt/supabase-callia/docker-compose.callia.yml /opt/supabase-callia/docker-compose.localonly.yml \
  /opt/callia-evolution/.env /opt/callia-evolution/docker-compose.yml \
  /etc/nginx/sites-available/callia.sistemalexis.com.br /etc/nginx/snippets/supabase-callia-proxy.conf 2>/dev/null

# Manifesto para conferência na restauração.
{
  echo "stamp=$stamp"
  docker exec callia-db psql -U postgres -tAc "select 'workspaces=' || count(*) from workspaces; select 'messages=' || count(*) from messages; select 'media_assets=' || count(*) from media_assets; select 'auth_users=' || count(*) from auth.users;"
  (cd "$work" && sha256sum ./*.dump ./*.tgz)
} > "$work/MANIFEST.txt"

out="$DEST_ROOT/callia-$stamp.tar.enc"
tar cf - -C "$work" . | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" -out "$out.partial"
mv "$out.partial" "$out"
chmod 600 "$out"
# Domingo: guarda também como semanal.
if [[ "$(date +%u)" == "7" ]]; then cp -p "$out" "$DEST_ROOT/weekly-callia-$stamp.tar.enc"; fi

# Retenção.
find "$DEST_ROOT" -maxdepth 1 -name 'callia-*.tar.enc' -mtime +"$KEEP_DAILY_DAYS" -delete
find "$DEST_ROOT" -maxdepth 1 -name 'weekly-callia-*.tar.enc' -mtime +"$KEEP_WEEKLY_DAYS" -delete

# Cópia fora do servidor (quando configurada).
if [[ -f "$OFFSITE_CONF" ]]; then
  # shellcheck disable=SC1090
  source "$OFFSITE_CONF"
  if [[ -n "${RCLONE_REMOTE:-}" ]] && command -v rclone >/dev/null; then
    rclone copy "$out" "$RCLONE_REMOTE" && echo "cópia externa: ok ($RCLONE_REMOTE)"
  fi
fi

date -Is > "$DEST_ROOT/.last-success"
echo "[$(date -Is)] ok $out ($(du -h "$out" | cut -f1))"
