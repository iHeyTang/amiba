#!/usr/bin/env bash
# Prove the create->install->build->pack loop works with NO registry:
# build local SDK tarballs, scaffold a demo extension, rewrite its tarball-URL
# deps to point at the local tarballs, then install + build + pack.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

echo "==> packing SDK tarballs"
bash scripts/sdk-pack.sh >/dev/null
API_VERSION=$(node -p "require('./packages/extension-api/package.json').version")
CLI_VERSION=$(node -p "require('./apps/extension-cli/package.json').version")
PRESET_VERSION=$(node -p "require('./packages/tailwind-preset/package.json').version")
API_TGZ="$ROOT/sdk-dist/hermes-x-extension-api-${API_VERSION}.tgz"
CLI_TGZ="$ROOT/sdk-dist/hermes-x-extension-cli-${CLI_VERSION}.tgz"
PRESET_TGZ="$ROOT/sdk-dist/hermes-x-tailwind-preset-${PRESET_VERSION}.tgz"
for f in "$API_TGZ" "$CLI_TGZ" "$PRESET_TGZ"; do test -f "$f" || { echo "missing $f"; exit 1; }; done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "==> scaffolding demo in $WORK"
( cd "$WORK" && printf "\n" | node "$ROOT/apps/extension-cli/dist/cli.js" create demo --id com.example.demo --no-install )
EXT="$WORK/demo"

echo "==> rewriting tarball-URL deps -> local file: paths"
node -e "
const fs=require('fs'), p='$EXT/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.devDependencies['@hermes-x/extension-api']='file:$API_TGZ';
j.devDependencies['@hermes-x/extension-cli']='file:$CLI_TGZ';
j.devDependencies['@hermes-x/tailwind-preset']='file:$PRESET_TGZ';
fs.writeFileSync(p, JSON.stringify(j,null,2));
"

echo "==> install (isolated, ignore monorepo workspace)"
( cd "$EXT" && pnpm install --ignore-workspace )
echo "==> build"
( cd "$EXT" && pnpm build )
test -f "$EXT/dist/main.cjs" || { echo "FAIL: dist/main.cjs missing"; exit 1; }
echo "==> pack (extension tarball via hermes-x-ext)"
( cd "$EXT" && pnpm run pack )
test -f "$EXT/extension.tgz" || { echo "FAIL: extension.tgz missing"; exit 1; }

echo "✅ scaffold consumes local SDK tarballs end-to-end (install + build + pack)"
