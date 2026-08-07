#!/usr/bin/env bash
# Launch the desktop dev server in a sandboxed environment that mimics a
# brand-new user (no Amiba-managed Hermes runtime) so onboarding can be
# exercised end-to-end without touching the real ~/.hermes install, system
# Hermes binary, or launchd-managed gateway.
#
# Two modes:
#   (default)  ephemeral: mktemp HOME, bundled runtime is copied each time,
#              everything wiped on exit. Closest to a true first-run.
#   --keep     persistent: HOME=~/.hermes-fresh-sandbox, install runs
#              once and is reused; on each launch we just hide the
#              managed binary so the wizard re-fires. Fast for UI work.
#
# Either way, the real ~/.hermes and system Hermes process are never modified.

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "fresh-desktop.sh currently supports macOS only" >&2
  exit 1
fi

KEEP=0
if [[ "${1:-}" == "--keep" ]]; then
  KEEP=1
fi

HIDDEN_BIN=""
SANDBOX=""

cleanup() {
  set +e
  if [[ -n "$HIDDEN_BIN" && -e "${HIDDEN_BIN}.fresh-bak" ]]; then
    mv "${HIDDEN_BIN}.fresh-bak" "$HIDDEN_BIN"
  fi
  if (( KEEP == 0 )) && [[ -n "$SANDBOX" && -d "$SANDBOX" ]]; then
    rm -rf "$SANDBOX"
  fi
}
trap cleanup EXIT INT TERM

if (( KEEP == 1 )); then
  SANDBOX="$HOME/.hermes-fresh-sandbox"
  mkdir -p "$SANDBOX"
  echo "[fresh] sandbox HOME = $SANDBOX (persistent)"
else
  SANDBOX=$(mktemp -d -t hermes-fresh)
  echo "[fresh] sandbox HOME = $SANDBOX (ephemeral, wiped on exit)"
fi

export AMIBA_HERMES_USER_DATA_DIR="$SANDBOX/amiba-user-data"

if (( KEEP == 1 )); then
  for candidate in "$AMIBA_HERMES_USER_DATA_DIR"/hermes/runtimes/*/python/bin/python3.11; do
    [[ -f "$candidate" ]] || continue
    HIDDEN_BIN="$candidate"
    echo "[fresh] hiding cached managed runtime interpreter so wizard re-fires"
    mv "$HIDDEN_BIN" "${HIDDEN_BIN}.fresh-bak"
    break
  done
fi

# Resolve the dirs holding pnpm + node BEFORE we rebuild PATH. The reset
# below keeps the harness deterministic while preserving pnpm and node.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[fresh] pnpm not found on PATH — install it before running this script" >&2
  exit 1
fi
PNPM_BIN_DIR=$(dirname "$(command -v pnpm)")
NODE_BIN_DIR=$(dirname "$(command -v node 2>/dev/null || echo /usr/bin/node)")

# Packaging and onboarding intentionally never fall back to a source install.
# Fail early with the preparation command when the local platform bundle is
# absent rather than opening a wizard that cannot complete.
pnpm --filter @amiba/desktop runtime:verify

export HOME="$SANDBOX"
# The managed runtime never discovers PATH Hermes, but keep only the minimum
# tools here so the desktop process environment remains reproducible.
export PATH="$SANDBOX/.local/bin:$PNPM_BIN_DIR:$NODE_BIN_DIR:/usr/bin:/bin:/usr/sbin:/sbin"

echo "[fresh] launching pnpm dev:desktop"
exec pnpm dev:desktop
