#!/usr/bin/env bash
# Launch the desktop dev server in a sandboxed environment that mimics a
# brand-new user data directory while executing the managed DSH runtime
# directly from application resources. Normal Amiba state remains untouched.
#
# Two modes:
#   (default)  ephemeral: mktemp HOME, user data is wiped on exit.
#   --keep     persistent: HOME=~/.amiba-dsh-fresh-sandbox, user configuration
#              and sessions are reused. Fast for UI work.
#
# Neither mode copies the runtime or uses a system DSH installation.

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "fresh-desktop.sh currently supports macOS only" >&2
  exit 1
fi

KEEP=0
if [[ "${1:-}" == "--keep" ]]; then
  KEEP=1
fi

SANDBOX=""

cleanup() {
  set +e
  if (( KEEP == 0 )) && [[ -n "$SANDBOX" && -d "$SANDBOX" ]]; then
    rm -rf "$SANDBOX"
  fi
}
trap cleanup EXIT INT TERM

if (( KEEP == 1 )); then
  SANDBOX="$HOME/.amiba-dsh-fresh-sandbox"
  mkdir -p "$SANDBOX"
  echo "[fresh] sandbox HOME = $SANDBOX (persistent)"
else
  SANDBOX=$(mktemp -d -t amiba-dsh-fresh)
  echo "[fresh] sandbox HOME = $SANDBOX (ephemeral, wiped on exit)"
fi

export AMIBA_USER_DATA_DIR="$SANDBOX/amiba-user-data"

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
pnpm runtime:verify

export HOME="$SANDBOX"
# The managed runtime never discovers a PATH-installed DSH, so keep only the minimum
# tools here so the desktop process environment remains reproducible.
export PATH="$SANDBOX/.local/bin:$PNPM_BIN_DIR:$NODE_BIN_DIR:/usr/bin:/bin:/usr/sbin:/sbin"

echo "[fresh] launching pnpm dev:desktop"
exec pnpm dev:desktop
