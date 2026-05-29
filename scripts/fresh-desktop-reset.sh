#!/usr/bin/env bash
# Recover from a crashed `fresh-desktop.sh` run.
#
# `fresh-desktop.sh` does three things that need undoing on exit:
#   1. mv's the cached sandbox hermes binary out of the way (--keep mode)
#   2. bootouts the user's real launchd-managed gateway
#   3. mktemp's an ephemeral sandbox HOME (default mode)
#
# Its EXIT/INT/TERM trap normally restores 1+2 and rm -rf's 3. But a
# SIGKILL, OS crash, or anything that kills bash without a signal-handling
# chance leaves those side effects in place. Most visibly: the real
# hermes gateway stays down until you re-bootstrap it by hand.
#
# This script is the manual rescue. Safe to run any time — every action
# is idempotent and "no-op" if there's nothing to recover.
#
# Usage:
#   bash scripts/fresh-desktop-reset.sh         # default: rescue + clean
#                                               # ephemeral sandboxes only
#   bash scripts/fresh-desktop-reset.sh --all   # also nuke the persistent
#                                               # --keep sandbox

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "fresh-desktop-reset.sh currently supports macOS only" >&2
  exit 1
fi

NUKE_PERSISTENT=0
if [[ "${1:-}" == "--all" ]]; then
  NUKE_PERSISTENT=1
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

# 1. Restore the cached hermes binary if the previous run hid it.
#    Only applies to --keep mode; ephemeral sandboxes are deleted whole.
PERSISTENT_SANDBOX="$HOME/.hermes-fresh-sandbox"
HIDDEN_BIN="$PERSISTENT_SANDBOX/.local/bin/hermes"
if [[ -e "${HIDDEN_BIN}.fresh-bak" ]]; then
  if [[ -e "$HIDDEN_BIN" ]]; then
    # Real bin somehow came back too — keep both, but rename the backup
    # so it stops shadowing future reset runs.
    mv "${HIDDEN_BIN}.fresh-bak" "${HIDDEN_BIN}.fresh-bak.$(date +%s)"
    echo "[reset] WARN: both ${HIDDEN_BIN} and its backup exist; backup renamed with timestamp"
  else
    mv "${HIDDEN_BIN}.fresh-bak" "$HIDDEN_BIN"
    echo "[reset] restored cached hermes binary at ${HIDDEN_BIN}"
  fi
else
  echo "[reset] no hidden hermes binary backup to restore"
fi

# 2. Re-bootstrap the real launchd-managed gateway if it isn't already
#    loaded. `print` exits non-zero when the service isn't loaded, which
#    is exactly the case we want to recover from.
if [[ -n "$PLIST_PATH" ]]; then
  if launchctl print "$DOMAIN" >/dev/null 2>&1; then
    echo "[reset] real gateway already loaded (${LABEL})"
  else
    if launchctl bootstrap "gui/${UID_NUM}" "$PLIST_PATH" 2>/dev/null; then
      echo "[reset] re-bootstrapped real gateway from ${PLIST_PATH}"
    else
      echo "[reset] WARN: failed to bootstrap ${PLIST_PATH} — already loaded under a different domain?" >&2
    fi
  fi
else
  echo "[reset] no ai.hermes.gateway plist found — nothing to bootstrap"
fi

# 3. Clean up ephemeral sandboxes left over in the user's temp dir.
#    mktemp -t prefix produces /var/folders/.../T/<prefix>.XXXXX; we
#    match the same prefix `fresh-desktop.sh` uses ("hermes-fresh").
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

# 4. --all: also wipe the persistent --keep sandbox so the next run
#    starts fully clean. This drops the cached hermes install + plugin
#    state, so the next `--keep` invocation reinstalls from scratch.
if (( NUKE_PERSISTENT == 1 )); then
  if [[ -d "$PERSISTENT_SANDBOX" ]]; then
    rm -rf "$PERSISTENT_SANDBOX"
    echo "[reset] removed persistent sandbox $PERSISTENT_SANDBOX"
  else
    echo "[reset] no persistent sandbox at $PERSISTENT_SANDBOX"
  fi
fi

echo "[reset] done."
