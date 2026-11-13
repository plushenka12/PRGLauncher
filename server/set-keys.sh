#!/usr/bin/env bash
# Asks for the RAWG and Steam Web API keys without echoing them and writes them
# to /etc/prglauncher/env (root only). An empty answer keeps the current key.
set -euo pipefail
ENV=/etc/prglauncher/env
sudo test -f "$ENV" || { echo "Run server/setup.sh first."; exit 1; }

# With --from FILE the keys come from lines NAME=value in that file (uploaded
# by scripts/upload-keys.sh), which is deleted afterwards.
FROM=""
if [ "${1:-}" = "--from" ]; then FROM="${2:?file}"; fi

update() {
  local name="$1" value
  if [ -n "$FROM" ]; then
    value="$(grep -m1 "^[[:space:]]*$name[[:space:]]*=" "$FROM" | cut -d= -f2- || true)"
    [ -z "$(printf '%s' "$value" | tr -d '[:space:]')" ] && { echo "  $name not in the file, kept."; return; }
  else
    read -r -s -p "$name (Enter = keep current): " value; echo
  fi
  # A pasted key can arrive wrapped in the terminal's bracketed-paste markers
  # or with spaces and a carriage return around it.
  value="${value//$'\e[200~'/}"; value="${value//$'\e[201~'/}"
  value="$(printf '%s' "$value" | tr -d '[:space:]')"
  [ -z "$value" ] && return
  if ! [[ "$value" =~ ^[A-Za-z0-9]{16,64}$ ]]; then
    # Only the shape of the input is shown, never the input itself.
    echo "  $name does not look like an API key (${#value} characters, $(printf '%s' "$value" | tr -d 'A-Za-z0-9' | wc -c) of them not letters or digits), skipped."
    return
  fi
  sudo sed -i "/^$name=/d" "$ENV"
  printf '%s=%s\n' "$name" "$value" | sudo tee -a "$ENV" >/dev/null
  echo "  $name saved."
}

update RAWG_API_KEY
update STEAM_WEB_API_KEY
[ -n "$FROM" ] && shred -u "$FROM" 2>/dev/null || { [ -n "$FROM" ] && rm -f "$FROM"; }
sudo chmod 600 "$ENV"
sudo systemctl restart prglauncher-functions
echo "Functions restarted: $(systemctl is-active prglauncher-functions)"
