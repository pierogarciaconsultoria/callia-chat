#!/usr/bin/env bash
# Publica o Callia em produção (callia.sistemalexis.com.br): painel + edge functions.
# Migrations novas NÃO são aplicadas aqui; ver DEPLOY_RUNBOOK.md ("Produção").
# Uso: bash scripts/deploy.sh [frontend|functions|all]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK=/opt/supabase-callia
WEB=/var/www/callia
what="${1:-all}"

if [[ "$what" == "all" || "$what" == "functions" ]]; then
  rsync -a --delete --exclude main "$ROOT/supabase/functions/" "$STACK/volumes/functions/"
  docker restart callia-edge-functions >/dev/null
  echo "functions publicadas"
fi

if [[ "$what" == "all" || "$what" == "frontend" ]]; then
  cd "$ROOT"
  ANON="$(grep '^ANON_KEY=' "$STACK/.env" | cut -d= -f2-)"
  VITE_SUPABASE_URL=https://callia.sistemalexis.com.br VITE_SUPABASE_PUBLISHABLE_KEY="$ANON" npm run build
  rel="$WEB/releases/$(date -u +%Y%m%d-%H%M%S)"
  mkdir -p "$rel" && cp -a dist/. "$rel/"
  ln -sfn "$rel" "$WEB/current" && chown -R deploy:deploy "$WEB"
  # Mantém as 5 releases mais recentes para rollback.
  ls -1dt "$WEB"/releases/* | tail -n +6 | xargs -r rm -rf
  echo "painel publicado: $rel"
fi
