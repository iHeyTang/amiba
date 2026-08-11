#!/usr/bin/env bash
# Remove sandboxes left behind by an interrupted fresh-desktop.sh run.
#
# Usage:
#   bash scripts/fresh-desktop-reset.sh
#   bash scripts/fresh-desktop-reset.sh --all  # also remove --keep data

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "fresh-desktop-reset.sh currently supports macOS only" >&2
  exit 1
fi

NUKE_PERSISTENT=0
if [[ "${1:-}" == "--all" ]]; then
  NUKE_PERSISTENT=1
fi

TMP_PARENT=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || echo "/tmp")
shopt -s nullglob
EPHEMERAL=("${TMP_PARENT%/}/hermes-fresh."*)
shopt -u nullglob
if (( ${#EPHEMERAL[@]} > 0 )); then
  for dir in "${EPHEMERAL[@]}"; do
    if [[ -d "$dir" ]]; then
      rm -rf "$dir"
      echo "[reset] removed ephemeral sandbox $dir"
    fi
  done
else
  echo "[reset] no ephemeral sandboxes to remove"
fi

PERSISTENT_SANDBOX="$HOME/.hermes-fresh-sandbox"
if (( NUKE_PERSISTENT == 1 )); then
  if [[ -d "$PERSISTENT_SANDBOX" ]]; then
    rm -rf "$PERSISTENT_SANDBOX"
    echo "[reset] removed persistent sandbox $PERSISTENT_SANDBOX"
  else
    echo "[reset] no persistent sandbox at $PERSISTENT_SANDBOX"
  fi
fi

echo "[reset] done."
