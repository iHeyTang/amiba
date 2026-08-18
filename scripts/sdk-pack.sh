#!/usr/bin/env bash
# Pack the externally-consumable SDK packages into sdk-dist/ as .tgz files.
# These are uploaded to a GitHub Release tagged `sdk-v<API_VERSION>`.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/sdk-dist"
rm -rf "$OUT"
mkdir -p "$OUT"
for dir in packages/extension-sdk apps/cli; do
  echo "packing ${dir}..."
  pnpm -C "$dir" pack --pack-destination "$OUT"
done
echo "---"
ls -1 "$OUT"
