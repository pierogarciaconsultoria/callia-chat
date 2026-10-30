#!/usr/bin/env bash
# Configura o destino externo do backup (remoto "callia-backup" do rclone) a partir de um arquivo de credenciais que
# fica só no servidor, testa o acesso, envia os pacotes locais que ainda não estão lá e confere.
#
# 1. Crie o arquivo /root/.callia-backup-remote.env (chmod 600) com UM dos formatos:
#      # Backblaze B2 (chave de aplicação restrita ao bucket)
#      REMOTE_TYPE=b2
#      B2_KEY_ID=...
#      B2_APP_KEY=...
#      BUCKET=callia-backups
#
#      # Qualquer S3 compatível (Cloudflare R2, Wasabi, AWS S3, MinIO)
#      REMOTE_TYPE=s3
#      S3_ACCESS_KEY=...
#      S3_SECRET_KEY=...
#      S3_ENDPOINT=https://<conta>.r2.cloudflarestorage.com   (vazio para AWS)
#      S3_REGION=auto
#      BUCKET=callia-backups
# 2. Rode: bash scripts/backup-remote-setup.sh
# Depois disso o backup diário (03:30) envia sozinho; retenção remota de 60 dias (scripts/backup.sh).
set -euo pipefail
CREDS=/root/.callia-backup-remote.env
DEST=/var/backups/callia
REMOTE_NAME=callia-backup

if [[ ! -s "$CREDS" ]]; then
  echo "faltou $CREDS — crie o arquivo com as credenciais (modelo no cabeçalho deste script)." >&2
  exit 1
fi
if [[ "$(stat -c %a "$CREDS")" != "600" ]]; then
  chmod 600 "$CREDS"
  echo "permissão de $CREDS ajustada para 600"
fi
# shellcheck disable=SC1090
set -a; source "$CREDS"; set +a
BUCKET="${BUCKET:-callia-backups}"
command -v rclone >/dev/null || { echo "rclone não instalado (apt install rclone)" >&2; exit 1; }

case "${REMOTE_TYPE:-}" in
  b2)
    : "${B2_KEY_ID:?defina B2_KEY_ID}" "${B2_APP_KEY:?defina B2_APP_KEY}"
    rclone config create "$REMOTE_NAME" b2 account="$B2_KEY_ID" key="$B2_APP_KEY" hard_delete=true --non-interactive >/dev/null
    ;;
  s3)
    : "${S3_ACCESS_KEY:?defina S3_ACCESS_KEY}" "${S3_SECRET_KEY:?defina S3_SECRET_KEY}"
    rclone config create "$REMOTE_NAME" s3 provider="${S3_PROVIDER:-Other}" access_key_id="$S3_ACCESS_KEY" secret_access_key="$S3_SECRET_KEY" \
      endpoint="${S3_ENDPOINT:-}" region="${S3_REGION:-auto}" no_check_bucket=true --non-interactive >/dev/null
    ;;
  *) echo "REMOTE_TYPE deve ser b2 ou s3" >&2; exit 1 ;;
esac
chmod 600 /root/.config/rclone/rclone.conf

# A variável REMOTE em scripts/backup.sh é callia-backup:callia-backups; se o bucket tiver outro nome, avisa.
if [[ "$BUCKET" != "callia-backups" ]]; then
  echo "atenção: scripts/backup.sh usa o bucket 'callia-backups'; o seu é '$BUCKET'. Ajuste REMOTE no script." >&2
fi
TARGET="$REMOTE_NAME:$BUCKET"

echo "testando acesso a $TARGET…"
if ! rclone lsd "$TARGET" >/dev/null 2>&1; then
  # Bucket pode não existir ainda (B2 cria; S3 depende da permissão).
  rclone mkdir "$TARGET" 2>/dev/null || true
fi
probe="callia-probe-$(date -u +%s).txt"
echo ok > "/tmp/$probe"
rclone copy "/tmp/$probe" "$TARGET/" && rclone deletefile "$TARGET/$probe" && rm -f "/tmp/$probe"
echo "acesso ok (gravar e apagar)"

echo "enviando pacotes locais que faltam…"
rclone copy "$DEST" "$TARGET/" --include 'callia-*.tar.gz.gpg' --progress 2>&1 | tail -3
echo "conferindo tamanhos…"
rclone check "$DEST" "$TARGET/" --include 'callia-*.tar.gz.gpg' --one-way 2>&1 | tail -2
echo
echo "remoto: $(rclone ls "$TARGET/" | wc -l) pacotes, $(rclone size "$TARGET/" --json | python3 -c 'import json,sys; print(round(json.load(sys.stdin)["bytes"]/1048576,1))') MB"
echo "pronto. O backup diário passa a enviar sozinho; para conferir: rclone ls $TARGET/"
echo "lembrete: guarde /root/.callia-backup.key fora do servidor — sem ela nenhum pacote abre."
