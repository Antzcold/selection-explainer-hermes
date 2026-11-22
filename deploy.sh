#!/usr/bin/env bash
# Deploy the plugin package into the default profile's plugins root.
# Usage: ./deploy.sh [--remove] [--all-profiles]
#
#   (no args)        deploy to the launch profile's root (~/.hermes/plugins/)
#   --all-profiles   ALSO deploy into every ~/.hermes/profiles/<p>/plugins/
#                    and enable the plugin on each profile.
#   --remove         remove the default-profile install only.
#
# Why --all-profiles exists: one gateway multiplexes every profile and mounts
# the Python half PER PROFILE (from that profile's own plugins root, gated by
# its own plugins.enabled), while the desktop half is app-global (loaded in
# every window). Skip a profile and its windows 404 on /explain.
set -euo pipefail
cd "$(dirname "$0")"

ID="selection-explainer-hermes"
HERMES="$(command -v hermes || echo "$HOME/.hermes/hermes-agent/.hermes/bin/hermes")"

deploy_into() {  # deploy_into <dest-dir>
  mkdir -p "$1"
  rsync -a --delete \
    --exclude '.git' --exclude '.DS_Store' --exclude '__pycache__' \
    ./ "$1/"
  echo "deployed → $1"
}

case "${1:-}" in
  --remove)
    rm -rf "$HOME/.hermes/plugins/$ID"
    echo "removed $HOME/.hermes/plugins/$ID"
    exit 0
    ;;
  --all-profiles)
    deploy_into "$HOME/.hermes/plugins/$ID"
    "$HERMES" plugins enable "$ID" >/dev/null && echo "enabled: default"
    for profile_dir in "$HOME/.hermes/profiles"/*/; do
      [[ -d "$profile_dir" ]] || continue
      profile="$(basename "$profile_dir")"
      deploy_into "$HOME/.hermes/profiles/$profile/plugins/$ID"
      "$HERMES" -p "$profile" plugins enable "$ID" >/dev/null \
        && echo "enabled: $profile"
    done
    echo "done — all profiles carry $ID (explanations use each profile's own model)"
    exit 0
    ;;
esac

deploy_into "$HOME/.hermes/plugins/$ID"
ls -la "$HOME/.hermes/plugins/$ID"
