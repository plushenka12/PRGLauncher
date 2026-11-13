#!/usr/bin/env bash
# Uploads the guest site and server functions to the Oracle server and runs
# server/setup.sh there. Usage (Git Bash):  bash scripts/deploy-oracle.sh
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${PRG_ORACLE_KEY:-$HOME/.ssh/oracle-echopod.key}"
TARGET="${PRG_ORACLE_TARGET:-ubuntu@145.241.163.181}"
PORT="${PRG_ORACLE_PORT:-2222}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$(mktemp -d)/prglauncher-site-$STAMP.tar.gz"

tar -czf "$ARCHIVE" server/functions-server.cjs server/prglauncher-functions.service server/nginx-prglauncher.conf \
  server/setup.sh server/set-keys.sh netlify/functions/rawg-search.js netlify/functions/steam-library.js web-dashboard

scp -i "$KEY" -P "$PORT" -q "$ARCHIVE" "$TARGET:/tmp/prglauncher-site.tar.gz"
ssh -i "$KEY" -p "$PORT" "$TARGET" 'set -e; rm -rf ~/prglauncher-deploy; mkdir -p ~/prglauncher-deploy; tar -xzf /tmp/prglauncher-site.tar.gz -C ~/prglauncher-deploy; rm /tmp/prglauncher-site.tar.gz; sed -i "s/\r$//" ~/prglauncher-deploy/server/*.sh; bash ~/prglauncher-deploy/server/setup.sh'
rm -f "$ARCHIVE"
