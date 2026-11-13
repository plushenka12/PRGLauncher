#!/usr/bin/env bash
# Installs or updates the PRGLauncher site and functions on the Oracle server.
# Run as the sudo user from the unpacked release folder:  bash server/setup.sh
# Safe to run again; it leaves /etc/prglauncher/env (the keys) untouched once
# it exists and does not touch other nginx sites.
set -euo pipefail

HOST=prg.145-241-163-181.sslip.io
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/prglauncher
WEB=/var/www/prglauncher
ENV_DIR=/etc/prglauncher

id prglauncher >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin prglauncher

# Functions: only the server wrapper and the two handlers.
sudo install -d -m 755 "$APP/server" "$APP/netlify/functions"
sudo install -m 644 "$SRC/server/functions-server.cjs" "$APP/server/"
sudo install -m 644 "$SRC/netlify/functions/rawg-search.js" "$SRC/netlify/functions/steam-library.js" "$APP/netlify/functions/"

# Site: the guest page, swapped in whole.
sudo install -d -m 755 "$WEB.new"
sudo cp -r "$SRC/web-dashboard/." "$WEB.new/"
sudo rm -rf "$WEB.new/_retired" "$WEB.new/README.md"
sudo find "$WEB.new" -type d -exec chmod 755 {} + && sudo find "$WEB.new" -type f -exec chmod 644 {} +
if [ -d "$WEB" ]; then sudo rm -rf "$WEB.old" && sudo mv "$WEB" "$WEB.old"; fi
sudo mv "$WEB.new" "$WEB" && sudo rm -rf "$WEB.old"

# Keys: created once with the public Firebase web key only.
sudo install -d -m 700 "$ENV_DIR"
if [ ! -f "$ENV_DIR/env" ]; then
  printf 'FIREBASE_WEB_API_KEY=AIzaSyBL-IHjUiSlmJ2N_caWx_MWAI8v2RL4Rpw\nRAWG_API_KEY=\nSTEAM_WEB_API_KEY=\n' | sudo tee "$ENV_DIR/env" >/dev/null
  sudo chmod 600 "$ENV_DIR/env"
fi

sudo install -m 644 "$SRC/server/prglauncher-functions.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now prglauncher-functions >/dev/null
sudo systemctl restart prglauncher-functions

# nginx: install the HTTP site once; certbot then adds HTTPS to the same file.
if [ ! -f /etc/nginx/sites-available/prglauncher ]; then
  sudo install -m 644 "$SRC/server/nginx-prglauncher.conf" /etc/nginx/sites-available/prglauncher
  sudo ln -sf /etc/nginx/sites-available/prglauncher /etc/nginx/sites-enabled/prglauncher
  sudo nginx -t
  sudo systemctl reload nginx
fi
if ! sudo test -d "/etc/letsencrypt/live/$HOST"; then
  sudo certbot --nginx -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi
sudo nginx -t && sudo systemctl reload nginx

sleep 1
systemctl is-active prglauncher-functions
echo "Site: https://$HOST/"
