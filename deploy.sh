#!/usr/bin/env bash
# Deploy the plugin package into the default profile's plugins root.
# Usage: ./deploy.sh [--remove]
set -euo pipefail
cd "$(dirname "$0")"

ID="selection-explainer-hermes"
DEST="$HOME/.hermes/plugins/$ID"

if [[ "${1:-}" == "--remove" ]]; then
  rm -rf "$DEST"
  echo "removed $DEST"
  exit 0
fi

mkdir -p "$DEST"
rsync -a --delete \
  --exclude '.git' --exclude '.DS_Store' --exclude '__pycache__' \
  ./ "$DEST/"
echo "deployed → $DEST"
ls -la "$DEST"
