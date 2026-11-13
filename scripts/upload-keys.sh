#!/usr/bin/env bash
# Sends RAWG/Steam keys from a local file to the Oracle server and deletes the
# local file. The file has lines RAWG_API_KEY=... and STEAM_WEB_API_KEY=...
# Usage (Git Bash):  bash scripts/upload-keys.sh ~/prg-keys.txt
set -euo pipefail
FILE="${1:?usage: upload-keys.sh FILE}"
KEY="${PRG_ORACLE_KEY:-$HOME/.ssh/oracle-echopod.key}"
TARGET="${PRG_ORACLE_TARGET:-ubuntu@145.241.163.181}"
PORT="${PRG_ORACLE_PORT:-2222}"
[ -s "$FILE" ] || { echo "The key file is empty or missing: $FILE"; exit 1; }

REMOTE="/tmp/prg-keys-$$"
ssh -i "$KEY" -p "$PORT" "$TARGET" "umask 077; cat > $REMOTE" < "$FILE"
ssh -i "$KEY" -p "$PORT" "$TARGET" "sed -i 's/\r$//' $REMOTE; bash prglauncher-deploy/server/set-keys.sh --from $REMOTE"
rm -f "$FILE"
echo "Local key file deleted."
