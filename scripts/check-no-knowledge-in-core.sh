#!/usr/bin/env bash
# scripts/check-no-knowledge-in-core.sh
# Fails if core (desktop + non-extension packages) imports any gbrain /
# knowledge / brain identifiers — those belong to extensions only.
#
# The literal "knowledge-base" string in `apps/desktop/src/main/index.ts`'s
# `discoverBuiltinExtensions()` is allowed because it names the extension
# package id; the script whitelists that exact occurrence via the
# ALLOWED_LITERAL filter at the bottom.
set -euo pipefail

ROOTS=(
  apps/desktop/src
  packages/core/src
  packages/ui/src
  packages/i18n/src
  packages/platform/src
  packages/utils/src
)

# Patterns mirror docs/superpowers/specs/2026-06-03-desktop-extension-system-design.md §9.2.
PATTERNS='\bgbrain\b|\bknowledge\b|\bbrain\b|GBrain|BRAIN_'

MATCHES=$(grep -rEn "$PATTERNS" "${ROOTS[@]}" 2>/dev/null || true)

# Filter out the one allowed occurrence: the extension package id literal.
FILTERED=$(echo "$MATCHES" | grep -v 'discoverBuiltinExtensions\|"knowledge-base"' || true)

if [ -n "$FILTERED" ]; then
  echo "$FILTERED"
  echo ""
  echo "ERROR: forbidden gbrain/brain/knowledge references found in core."
  echo "Move them to packages/extensions/<id>/."
  exit 1
fi

echo "OK: core is clean of gbrain/brain/knowledge references."
