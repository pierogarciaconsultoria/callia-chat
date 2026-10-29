#!/usr/bin/env bash
# Troca o domínio público do Callia (painel + API) mantendo o antigo servindo a API (webhooks da Evolution,
# Mercado Pago e chaves de API continuam apontando para ele) e redirecionando o painel para o novo.
# Pré-requisito: DNS de NEW_HOST e APEX apontando para este servidor. Idempotente; faz backup do que altera.
# Uso: sudo bash scripts/switch-domain.sh www.callia.app.br callia.app.br [callia.sistemalexis.com.br]
set -euo pipefail
NEW_HOST="${1:?novo host do painel (ex.: www.callia.app.br)}"
APEX="${2:?apex que redireciona para o novo host (ex.: callia.app.br)}"
OLD_HOST="${3:-callia.sistemalexis.com.br}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK=/opt/supabase-callia
SITE_OLD="/etc/nginx/sites-available/$OLD_HOST"
SITE_NEW="/etc/nginx/sites-available/$APEX"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
MY_IP="$(curl -s -m 10 https://ifconfig.me || hostname -I | awk '{print $1}')"

# 1. DNS precisa estar aqui (conferido no servidor autoritativo, que é o que a Let's Encrypt consulta), senão o
#    certificado falha e o painel some. Caches locais podem estar velhos: as conferências usam --resolve.
NS="$(dig +short NS "$APEX" | head -1)"
for h in "$NEW_HOST" "$APEX"; do
  got="$(dig +short A "$h" @"${NS:-8.8.8.8}" | tail -1)"
  [[ "$got" == "$MY_IP" ]] || { echo "DNS de $h aponta para '${got:-nada}', esperado $MY_IP. Aguarde a propagação."; exit 1; }
done
command -v resolvectl >/dev/null && resolvectl flush-caches || true
R=(--resolve "$NEW_HOST:443:$MY_IP" --resolve "$APEX:443:$MY_IP" --resolve "$NEW_HOST:80:$MY_IP" --resolve "$APEX:80:$MY_IP")

# 2. Site novo: mesma configuração do antigo, com server_name novo; apex só redireciona.
if [[ ! -f "$SITE_NEW" ]]; then
  # Bloco principal do site antigo (até antes do bloco HTTP do certbot), sem as linhas de TLS: o certbot recoloca.
  {
    echo "# Callia Chat (código em /root/callia-chat): painel + Supabase em 127.0.0.1:8300. Gerado por scripts/switch-domain.sh"
    awk '/^server \{/{n++} n==1' "$SITE_OLD" \
      | grep -vE "managed by Certbot|^\s*listen " \
      | sed -E "s/server_name $OLD_HOST;/server_name $NEW_HOST;\n    listen 80;\n    listen [::]:80;/"
  } > "$SITE_NEW"
  cat >> "$SITE_NEW" <<BLOCK

server {
    listen 80;
    listen [::]:80;
    server_name $APEX;
    return 301 https://$NEW_HOST\$request_uri;
}
BLOCK
  ln -sfn "$SITE_NEW" "/etc/nginx/sites-enabled/$APEX"
  nginx -t
  systemctl reload nginx
  echo "nginx: site $APEX criado (HTTP)"
fi

# 3. Certificado (o plugin nginx adiciona o TLS e o redirecionamento HTTP→HTTPS nos dois blocos).
if [[ ! -d "/etc/letsencrypt/live/$NEW_HOST" ]]; then
  certbot --nginx -d "$NEW_HOST" -d "$APEX" --non-interactive --agree-tos --redirect --cert-name "$NEW_HOST"
  echo "certificado emitido para $NEW_HOST e $APEX"
fi

# 4. Painel no domínio antigo passa a redirecionar; a API (/rest, /auth, /storage, /functions, /realtime) continua lá.
if ! grep -q "return 301 https://$NEW_HOST" "$SITE_OLD"; then
  cp -a "$SITE_OLD" "$SITE_OLD.bak-$STAMP"
  python3 - "$SITE_OLD" "$NEW_HOST" <<'PY'
import re, sys
path, new = sys.argv[1], sys.argv[2]
s = open(path).read()
s2 = re.sub(r"    location / \{\n        try_files \$uri /index\.html;\n    \}", f"    location / {{\n        return 301 https://{new}$request_uri;\n    }}", s, count=1)
assert s2 != s, "bloco location / não encontrado"
open(path, "w").write(s2)
PY
  nginx -t && systemctl reload nginx
  echo "nginx: painel em $OLD_HOST redireciona para $NEW_HOST"
fi

# 5. Variáveis do stack: links de e-mail, URLs públicas de storage e de functions, URL de retorno do Mercado Pago.
cp -a "$STACK/.env" "$STACK/.env.bak-$STAMP"
cp -a "$STACK/functions.env" "$STACK/functions.env.bak-$STAMP"
set_var() { # arquivo chave valor
  if grep -q "^$2=" "$1"; then sed -i "s#^$2=.*#$2=$3#" "$1"; else printf '%s=%s\n' "$2" "$3" >> "$1"; fi
}
set_var "$STACK/.env" SITE_URL "https://$NEW_HOST"
set_var "$STACK/.env" ADDITIONAL_REDIRECT_URLS "https://$NEW_HOST/**,https://$OLD_HOST/**"
set_var "$STACK/.env" SUPABASE_PUBLIC_URL "https://$NEW_HOST"
set_var "$STACK/.env" FUNCTIONS_PUBLIC_URL "https://$NEW_HOST/functions/v1"
set_var "$STACK/functions.env" PUBLIC_SITE_URL "https://$NEW_HOST"
set_var "$STACK/functions.env" PANEL_URL "https://$NEW_HOST"
# API_EXTERNAL_URL fica no domínio antigo de propósito: é o issuer dos JWTs em uso e os links de verificação continuam válidos lá.
(cd "$STACK" && docker compose up -d auth storage functions api-gw studio)
echo "stack: auth, storage, functions, api-gw e studio recriados com o novo domínio"

# 6. Painel compilado apontando para o novo domínio (deploy.sh lê SUPABASE_PUBLIC_URL).
bash "$ROOT/scripts/deploy.sh" frontend

# 7. Conferência.
echo "--- conferência"
curl -s "${R[@]}" -o /dev/null -w "https://$NEW_HOST/            %{http_code}\n" "https://$NEW_HOST/"
curl -s "${R[@]}" -o /dev/null -w "https://$APEX/                %{http_code} -> %{redirect_url}\n" "https://$APEX/"
curl -s "${R[@]}" -o /dev/null -w "https://$NEW_HOST/auth/v1/health  %{http_code}\n" "https://$NEW_HOST/auth/v1/health"
curl -s -o /dev/null -w "https://$OLD_HOST/ (painel)  %{http_code} -> %{redirect_url}\n" "https://$OLD_HOST/"
curl -s -o /dev/null -w "https://$OLD_HOST/auth/v1/health  %{http_code}\n" "https://$OLD_HOST/auth/v1/health"
curl -s "${R[@]}" "https://$NEW_HOST/auth/v1/settings" | head -c 120; echo
