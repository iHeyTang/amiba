#!/usr/bin/env bash
# Prove the create->build->pack loop works without publishing Amiba SDK packages:
# build local SDK tarballs, scaffold a demo DSH plugin, then compile it against
# the repository's already locked dependency graph. Network availability is not
# part of this source-level contract check.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

echo "==> packing SDK tarballs"
bash scripts/sdk-pack.sh >/dev/null
SDK_VERSION=$(node -p "require('./packages/extension-sdk/package.json').version")
CLI_VERSION=$(node -p "require('./apps/cli/package.json').version")
SDK_TGZ="$ROOT/sdk-dist/amiba-extension-sdk-${SDK_VERSION}.tgz"
CLI_TGZ="$ROOT/sdk-dist/amiba-cli-${CLI_VERSION}.tgz"
for f in "$SDK_TGZ" "$CLI_TGZ"; do test -f "$f" || { echo "missing $f"; exit 1; }; done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "==> scaffolding demo in $WORK"
( cd "$WORK" && printf "\n" | node "$ROOT/apps/cli/dist/cli.js" plugin create demo --id demo --no-install )
EXT="$WORK/dsh-plugin-demo"

echo "==> linking the locked workspace dependency graph"
mkdir -p \
  "$EXT/node_modules/@amiba" \
  "$EXT/node_modules/@deepseek-ai" \
  "$EXT/node_modules/@types" \
  "$EXT/node_modules/.bin"
ln -s "$ROOT/packages/extension-sdk" "$EXT/node_modules/@amiba/extension-sdk"
ln -s "$ROOT/apps/cli" "$EXT/node_modules/@amiba/cli"
for package in cordis dsh-client-runtime dsh-client-ui-slots; do
  ln -s \
    "$ROOT/plugins/dsh-plugin-ui-shell/node_modules/@deepseek-ai/$package" \
    "$EXT/node_modules/@deepseek-ai/$package"
done
for package in node react; do
  ln -s \
    "$ROOT/plugins/dsh-plugin-ui-shell/node_modules/@types/$package" \
    "$EXT/node_modules/@types/$package"
done
for package in react typescript vite; do
  ln -s \
    "$ROOT/plugins/dsh-plugin-ui-shell/node_modules/$package" \
    "$EXT/node_modules/$package"
done
TSC_BIN=$(node -p "require.resolve('typescript/bin/tsc')")
VITE_BIN=$( \
  cd "$ROOT/plugins/dsh-plugin-ui-shell" && \
  node -p "require('node:path').resolve(require('node:path').dirname(require.resolve('vite')), 'bin/vite.js')" \
)
ln -s "$TSC_BIN" "$EXT/node_modules/.bin/tsc"
ln -s "$VITE_BIN" "$EXT/node_modules/.bin/vite"
ln -s "$ROOT/apps/cli/dist/cli.js" "$EXT/node_modules/.bin/amiba"

echo "==> build"
( cd "$EXT" && pnpm build )
test -f "$EXT/lib/index.js" || { echo "FAIL: lib/index.js missing"; exit 1; }
test -f "$EXT/lib/client.js" || { echo "FAIL: lib/client.js missing"; exit 1; }
echo "==> pack (DSH plugin tarball via amiba)"
( cd "$EXT" && pnpm run pack )
test -f "$EXT/dsh-plugin.tgz" || { echo "FAIL: dsh-plugin.tgz missing"; exit 1; }

echo "✅ DSH plugin scaffold consumes the local SDK end-to-end (build + pack)"
