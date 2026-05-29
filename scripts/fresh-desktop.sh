#!/usr/bin/env bash
# Launch the desktop dev server in a sandboxed environment that mimics a
# brand-new user (no hermes binary on disk, no backplane on 9394) so the
# onboarding wizard can be exercised end-to-end without touching the
# real ~/.hermes install or the launchd-managed gateway.
#
# Two modes:
#   (default)  ephemeral: mktemp HOME, full install runs each time,
#              everything wiped on exit. Closest to a true first-run.
#   --keep     persistent: HOME=~/.hermes-fresh-sandbox, install runs
#              once and is reused; on each launch we just hide the
#              binary so the wizard re-fires. Fast for iterative UI work.
#
# Either way: real ~/.hermes, ~/.local/bin/hermes, and
# ~/Library/LaunchAgents/ai.hermes.gateway.plist are never modified.

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "fresh-desktop.sh currently supports macOS only" >&2
  exit 1
fi

KEEP=0
if [[ "${1:-}" == "--keep" ]]; then
  KEEP=1
fi

LABEL="ai.hermes.gateway"
UID_NUM=$(id -u)
DOMAIN="gui/${UID_NUM}/${LABEL}"

PLIST_PATH=""
for candidate in \
  "$HOME/Library/LaunchAgents/${LABEL}.plist" \
  "/Library/LaunchAgents/${LABEL}.plist" \
  "/Library/LaunchDaemons/${LABEL}.plist"; do
  if [[ -f "$candidate" ]]; then
    PLIST_PATH="$candidate"
    break
  fi
done

BOOTED_OUT=0
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
  if (( BOOTED_OUT == 1 )) && [[ -n "$PLIST_PATH" ]]; then
    launchctl bootstrap "gui/${UID_NUM}" "$PLIST_PATH" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ -n "$PLIST_PATH" ]]; then
  echo "[fresh] stopping launchd-managed gateway (${LABEL})"
  if launchctl bootout "$DOMAIN" 2>/dev/null; then
    BOOTED_OUT=1
  else
    # Already unloaded — leave BOOTED_OUT=0 so cleanup doesn't try to bootstrap
    # something the user manually disabled.
    echo "[fresh] (not loaded; nothing to stop)"
  fi
else
  echo "[fresh] no ai.hermes.gateway plist found — assuming gateway is not managed"
fi

if lsof -nP -iTCP:9394 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[fresh] WARNING: 9394 still listening — something else owns the port" >&2
  lsof -nP -iTCP:9394 -sTCP:LISTEN >&2 || true
fi

if (( KEEP == 1 )); then
  SANDBOX="$HOME/.hermes-fresh-sandbox"
  mkdir -p "$SANDBOX"
  HIDDEN_BIN="$SANDBOX/.local/bin/hermes"
  if [[ -e "$HIDDEN_BIN" ]]; then
    echo "[fresh] hiding cached hermes binary so wizard re-fires"
    mv "$HIDDEN_BIN" "${HIDDEN_BIN}.fresh-bak"
  fi
  echo "[fresh] sandbox HOME = $SANDBOX (persistent)"
else
  SANDBOX=$(mktemp -d -t hermes-fresh)
  echo "[fresh] sandbox HOME = $SANDBOX (ephemeral, wiped on exit)"
fi

# Resolve the dirs holding pnpm + node BEFORE we rebuild PATH. The reset
# below intentionally drops the user's `~/.local/bin` (where the real
# hermes binary lives) so the wizard's PATH-based `which hermes` probe
# doesn't accidentally find the real install — but pnpm and node still
# need to be reachable for the dev server to start.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[fresh] pnpm not found on PATH — install it before running this script" >&2
  exit 1
fi
PNPM_BIN_DIR=$(dirname "$(command -v pnpm)")
NODE_BIN_DIR=$(dirname "$(command -v node 2>/dev/null || echo /usr/bin/node)")

export HOME="$SANDBOX"
# Sandbox bin first so the wizard's absolute-path probe at
# `$HOME/.local/bin/hermes` resolves to an empty dir. After that, the
# minimum needed to run pnpm + node + standard CLI tools. Critically we
# do NOT include the user's `~/.local/bin` or `~/.cargo/bin` so the bare
# `"hermes"` candidate also comes up empty.
export PATH="$SANDBOX/.local/bin:$PNPM_BIN_DIR:$NODE_BIN_DIR:/usr/bin:/bin:/usr/sbin:/sbin"

echo "[fresh] launching pnpm dev:desktop"
exec pnpm dev:desktop
