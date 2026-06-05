#!/usr/bin/env bash
# Pack the externally-consumable SDK packages into sdk-dist/ as .tgz files.
# These are uploaded to a GitHub Release tagged `sdk-v<API_VERSION>`.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/sdk-dist"
rm -rf "$OUT"
mkdir -p "$OUT"
for pkg in @hermes-x/extension-api @hermes-x/tailwind-preset @hermes-x/extension-cli; do
  echo "packing ${pkg}..."
  pkg_path=$(pnpm -r ls --json --depth=0 2>/dev/null \
    | python3 -c "import json,sys; pkgs=json.load(sys.stdin); \
      [print(p['path']) for p in pkgs if p['name']=='${pkg}']")
  [ -n "$pkg_path" ] || { echo "ERROR: cannot resolve path for $pkg" >&2; exit 1; }
  pnpm -C "$pkg_path" pack --pack-destination "$OUT"
done
echo "---"
ls -1 "$OUT"
