# WS2 — Consumable SDK + Tarball Distribution + Standalone Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an extension live in a separate repo and build against the amiba SDK without the monorepo — by making `@amiba/{extension-api, tailwind-preset, extension-cli}` consumable from GitHub Release tarballs, and updating the existing `amiba-ext create` scaffold to generate a standalone repo that consumes them. (`@amiba/ui` is deferred — see spec §4.1.)

**Architecture:** `extension-api` keeps its top-level `exports` at `src` (so the monorepo, the desktop runner that bundles it, and all of WS1 are untouched); a `prepack` build + pnpm `publishConfig` make only the *packed tarball* point at a compiled `dist` (JS + `.d.ts`). `extension-cli` already builds to `dist`; its only `@amiba/*` dependency (`extension-api`) is **type-only**, so it moves to `devDependencies`, making the published CLI tarball self-contained. `tailwind-preset` is already a dep-free prebuilt JS file. A root `sdk:pack` script packs the three into `sdk-dist/`. The scaffold's template is repointed at `sdk-v1` tarball URLs, its monorepo-coupled bits removed. A verification script proves the whole create→install(local tarballs)→build→pack loop with no registry.

**Tech Stack:** TypeScript, tsc, pnpm (`pack`, `publishConfig`, `--pack-destination`), Vite (extension build), bash.

**Branch:** `feat/extension-sdk-versioning` (WS1 already landed here). **Spec:** `docs/superpowers/specs/2026-06-05-extension-distribution-and-versioning-design.md` (§4, revised).

**Commit identity:** Author all commits as `iHeyTang <dehui1012@gmail.com>` (pass `-c user.name=iHeyTang -c user.email=dehui1012@gmail.com` per commit, or set once on the branch).

**Locked decisions:** integer API level = `1` (so the release tag is `sdk-v1`); package versions are `0.1.0` (so tarball filenames are `amiba-<pkg>-0.1.0.tgz`); no public registry (tarball URLs only); `@amiba/ui` out of scope.

**Verbatim current state the tasks rely on:**
- `packages/extension-api/package.json`: `private: true`, `main`/`types`/`exports["."]` → `./src/index.ts`, also `exports["./manifest.schema.json"] → ./src/manifest.schema.json`; only script is `typecheck`; peer `react` (optional). It has NO `@amiba/*` dependency. Its sole runtime value export is `API_VERSION` (`src/version.ts`); everything else is types.
- `packages/extension-api/tsconfig.json`: `noEmit: true`, `module: ESNext`, `moduleResolution: Bundler`, `include: ["src"]`.
- `packages/extension-cli/package.json`: built (`bin: { "amiba-ext": "dist/cli.js" }`, `scripts.build = tsc`, `scripts.prepare = tsc`, `files: ["dist", "src/template"]`); `dependencies` includes `@amiba/extension-api: workspace:*` (used type-only — `src/lib/manifest.ts` does `import type { ExtensionManifest }`), plus `commander`, `kleur`, `prompts`, `tar`.
- `packages/tailwind-preset/package.json`: `private: true`, `main: "index.js"` (a prebuilt single file), no deps, no `files` field, no scripts.
- Root `package.json` scripts include `build:extensions`, etc.; `pnpm-workspace.yaml` = `apps/* packages/* extensions/*`.
- Scaffold `apps/extension-cli/src/commands/create.ts`: `walk()` copies `src/template/` → target, stripping `.tpl` and replacing `{{NAME}}`/`{{ID}}`/`{{AUTHOR}}`; non-`.tpl` files copied verbatim; recurses into subdirs (incl. dotdirs); then runs `pnpm install` unless `--no-install`.
- Template `package.json.tpl` devDeps include `@amiba/extension-api: "*"`, `@amiba/extension-cli: "*"`, `@amiba/tailwind-preset: "*"` (+ react/vite/tailwind/etc.); peer react/react-dom/electron. The template's `src/ui/main/App.tsx.tpl` is plain React (no `@amiba/ui`).
- Template `tailwind.config.cjs.tpl` (VERBATIM):
  ```js
  const path = require("path")
  const preset = require("@amiba/tailwind-preset")

  /** @type {import('tailwindcss').Config} */
  module.exports = {
    presets: [preset],
    content: [
      "./src/ui/**/*.{ts,tsx,html}",
      // Scan @amiba/ui workspace source for Tailwind class names.
      path.join(__dirname, "../../packages/ui/src/**/*.{ts,tsx}"),
    ],
  }
  ```
- Template `manifest.json.tpl` has `"version": "0.1.0",` then `"engines": { "amiba": "^0.1.0" },`.

---

## File Structure

- `packages/extension-api/tsconfig.build.json` — **Create.** Emit JS + `.d.ts` to `dist`.
- `packages/extension-api/package.json` — **Modify.** Add `build` + `prepack` scripts, `files`, `publishConfig` (dist overrides). Top-level `exports` unchanged.
- `packages/extension-api/.gitignore` — **Create** (or modify root ignore) to ignore `dist`.
- `packages/extension-cli/package.json` — **Modify.** Move `@amiba/extension-api` to `devDependencies`.
- `packages/tailwind-preset/package.json` — **Modify.** Add `files: ["index.js"]`.
- `scripts/sdk-pack.sh` — **Create.** Pack the 3 SDK packages into `sdk-dist/`.
- `package.json` (root) — **Modify.** Add `"sdk:pack"` script.
- `apps/extension-cli/src/template/package.json.tpl` — **Modify.** Repoint `@amiba/*` devDeps to `sdk-v1` tarball URLs.
- `apps/extension-cli/src/template/tailwind.config.cjs.tpl` — **Modify.** Drop the monorepo `../../packages/ui` content path.
- `apps/extension-cli/src/template/manifest.json.tpl` — **Modify.** Add `"apiVersion": 1`.
- `apps/extension-cli/src/template/README.md.tpl` — **Create.** Author quickstart.
- `apps/extension-cli/src/template/.github/workflows/release.yml` — **Create** (non-`.tpl`, copied verbatim). Tag → pack → release.
- `scripts/verify-scaffold.sh` — **Create.** End-to-end registry-free consumption check.
- `docs/marketplace-bootstrap.md` — **Modify.** Document the `sdk:pack` → release → tarball-dep workflow.
- `.gitignore` (root) — **Modify.** Ignore `sdk-dist/` and `packages/*/dist`.

---

## Task 1: Make `@amiba/extension-api` tarball-consumable (build on pack only)

**Files:**
- Create: `packages/extension-api/tsconfig.build.json`
- Modify: `packages/extension-api/package.json`
- Modify: root `.gitignore`

- [ ] **Step 1: Create the build tsconfig**

Create `packages/extension-api/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "module": "CommonJS",
    "moduleResolution": "Node"
  },
  "include": ["src/index.ts", "src/version.ts", "src/manifest.ts", "src/host.ts", "src/settings.ts", "src/webview.ts"]
}
```

(CommonJS output makes the single runtime value `API_VERSION` consumable by any tool; the package is otherwise types. We list `.ts` files explicitly so the JSON schema isn't treated as an emit input.)

- [ ] **Step 2: Verify the build emits dist**

Run: `pnpm -F @amiba/extension-api exec tsc -p tsconfig.build.json`
Expected: exit 0; `packages/extension-api/dist/index.js` and `dist/index.d.ts` (+ `version.*`, `manifest.*`, etc.) now exist.
Confirm: `node -e "console.log(require('./packages/extension-api/dist/index.js').API_VERSION)"` prints `1`.

- [ ] **Step 3: Wire scripts, files, and publishConfig (top-level exports stay at src)**

In `packages/extension-api/package.json`, change the `scripts` block and add `files` + `publishConfig`. The `main`/`types`/`exports` at the TOP level stay pointing at `./src/...` (monorepo keeps consuming source — do NOT change them). Result:

```json
{
  "name": "@amiba/extension-api",
  "version": "0.1.0",
  "private": true,
  "description": "Type-only contract between amiba extensions and the extension host.",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./manifest.schema.json": "./src/manifest.schema.json"
  },
  "files": ["dist", "src/manifest.schema.json"],
  "publishConfig": {
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "./manifest.schema.json": "./src/manifest.schema.json"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json",
    "prepack": "pnpm run build"
  },
  "peerDependencies": {
    "react": "^18.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true }
  },
  "devDependencies": {
    "@types/react": "18.3.12",
    "typescript": "5.6.3"
  }
}
```

(pnpm applies `publishConfig.{main,types,exports}` when packing/publishing, so the **tarball's** package.json points at `dist` while the in-repo package.json keeps `src`. `prepack` builds `dist` right before packing.)

- [ ] **Step 4: Ignore the build output**

Append to root `.gitignore` (if not already covered by the existing `dist` entry — it IS: the root `.gitignore` already lists `dist`). Verify `git status` shows no `packages/extension-api/dist`. If it does, add `packages/extension-api/dist` to `.gitignore`. (Expected: already ignored by the blanket `dist` rule — no edit needed; just confirm.)

- [ ] **Step 5: Pack and inspect the tarball**

Run: `pnpm -F @amiba/extension-api pack --pack-destination /tmp/sdk-check`
Expected: produces `/tmp/sdk-check/amiba-extension-api-0.1.0.tgz` (prepack ran the build first).
Inspect: `tar -xzf /tmp/sdk-check/amiba-extension-api-0.1.0.tgz -C /tmp/sdk-check && node -e "const p=require('/tmp/sdk-check/package/package.json'); if(p.main!=='dist/index.js'||p.exports['.'].default!=='./dist/index.js') throw new Error('publishConfig not applied: '+JSON.stringify(p.exports)); console.log('tarball exports → dist ✓')"`
Then confirm the files are present: `test -f /tmp/sdk-check/package/dist/index.js && test -f /tmp/sdk-check/package/dist/index.d.ts && test -f /tmp/sdk-check/package/src/manifest.schema.json && echo "tarball contents ✓"`.

- [ ] **Step 6: Confirm the monorepo is unaffected (top-level exports unchanged)**

Run: `pnpm -F @amiba/extension-host test && pnpm -F @amiba/extension-host exec tsc --noEmit && pnpm -F @amiba/extension-api exec tsc --noEmit`
Expected: 45 tests pass, both typechecks exit 0 (top-level `exports` still resolve to `src`, so nothing in the monorepo changed).

- [ ] **Step 7: Commit**

```bash
git add packages/extension-api/tsconfig.build.json packages/extension-api/package.json
git commit -m "feat(extension-api): build dist on pack via publishConfig (tarball-consumable; src unchanged in-repo)"
```

---

## Task 2: Make `@amiba/extension-cli` tarball self-contained

The CLI uses `@amiba/extension-api` only as a type (`import type { ExtensionManifest }` in `src/lib/manifest.ts`). Moving it to `devDependencies` means the packed CLI has no `@amiba/*` runtime dependency.

**Files:**
- Modify: `packages/extension-cli/package.json`

- [ ] **Step 1: Confirm extension-api is used type-only**

Run: `grep -rn "@amiba/extension-api" apps/extension-cli/src`
Expected: every hit is an `import type ...` (no value import). The known hit is `src/lib/manifest.ts:3: import type { ExtensionManifest } from "@amiba/extension-api"`. If ANY non-type import exists, STOP and report DONE_WITH_CONCERNS (moving to devDeps would break runtime) — do not proceed.

- [ ] **Step 2: Move the dependency to devDependencies**

In `packages/extension-cli/package.json`, remove `"@amiba/extension-api": "workspace:*"` from `dependencies` and add it to `devDependencies` (keep `workspace:*` — devDeps are not shipped to consumers). After the edit, `dependencies` should contain only `commander`, `kleur`, `prompts`, `tar`; `devDependencies` gains `@amiba/extension-api`.

- [ ] **Step 3: Typecheck + build still work**

Run: `pnpm -F @amiba/extension-cli exec tsc --noEmit && pnpm -F @amiba/extension-cli build`
Expected: exit 0; `apps/extension-cli/dist/cli.js` present.

- [ ] **Step 4: Pack and confirm no @amiba runtime dep**

Run: `pnpm -F @amiba/extension-cli pack --pack-destination /tmp/sdk-check`
Inspect: `tar -xzf /tmp/sdk-check/amiba-extension-cli-0.1.0.tgz -C /tmp/sdk-check-cli 2>/dev/null; mkdir -p /tmp/sdk-check-cli; tar -xzf /tmp/sdk-check/amiba-extension-cli-0.1.0.tgz -C /tmp/sdk-check-cli && node -e "const p=require('/tmp/sdk-check-cli/package/package.json'); const deps=Object.keys(p.dependencies||{}); const bad=deps.filter(d=>d.startsWith('@amiba/')); if(bad.length) throw new Error('CLI tarball still has @amiba runtime deps: '+bad); console.log('CLI tarball self-contained ✓ deps='+JSON.stringify(deps))"`
Expected: prints the self-contained confirmation (deps = commander/kleur/prompts/tar only).

- [ ] **Step 5: Commit**

```bash
git add packages/extension-cli/package.json
git commit -m "feat(extension-cli): make published tarball self-contained (extension-api is type-only → devDeps)"
```

---

## Task 3: `tailwind-preset` files + root `sdk:pack` script

**Files:**
- Modify: `packages/tailwind-preset/package.json`
- Create: `scripts/sdk-pack.sh`
- Modify: root `package.json`
- Modify: root `.gitignore`

- [ ] **Step 1: Add `files` to tailwind-preset**

In `packages/tailwind-preset/package.json`, add `"files": ["index.js"]` (so the tarball ships only the preset). Result:

```json
{
  "name": "@amiba/tailwind-preset",
  "version": "0.1.0",
  "private": true,
  "description": "Shared Tailwind preset — shadcn HSL color tokens, radius, font stack, darkMode class strategy.",
  "main": "index.js",
  "exports": {
    ".": "./index.js"
  },
  "files": ["index.js"]
}
```

- [ ] **Step 2: Create the pack script**

Create `scripts/sdk-pack.sh`:

```bash
#!/usr/bin/env bash
# Pack the externally-consumable SDK packages into sdk-dist/ as .tgz files.
# These are uploaded to a GitHub Release tagged `sdk-v<API_VERSION>`.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/sdk-dist"
rm -rf "$OUT"
mkdir -p "$OUT"
for pkg in @amiba/extension-api @amiba/tailwind-preset @amiba/extension-cli; do
  echo "packing $pkg…"
  pnpm --filter "$pkg" pack --pack-destination "$OUT"
done
echo "---"
ls -1 "$OUT"
```

Make it executable: `chmod +x scripts/sdk-pack.sh`.

- [ ] **Step 3: Add the root script + ignore sdk-dist**

In root `package.json` `scripts`, add: `"sdk:pack": "bash scripts/sdk-pack.sh"`.
Append `sdk-dist/` to root `.gitignore`.

- [ ] **Step 4: Run it**

Run: `pnpm sdk:pack`
Expected: `sdk-dist/` contains exactly `amiba-extension-api-0.1.0.tgz`, `amiba-tailwind-preset-0.1.0.tgz`, `amiba-extension-cli-0.1.0.tgz`.

- [ ] **Step 5: Commit**

```bash
git add packages/tailwind-preset/package.json scripts/sdk-pack.sh package.json .gitignore
git commit -m "feat(sdk): sdk:pack script packs extension-api + tailwind-preset + extension-cli tarballs"
```

---

## Task 4: Repoint the scaffold template at tarball deps; remove monorepo coupling

**Files:**
- Modify: `apps/extension-cli/src/template/package.json.tpl`
- Modify: `apps/extension-cli/src/template/tailwind.config.cjs.tpl`
- Modify: `apps/extension-cli/src/template/manifest.json.tpl`
- Create: `apps/extension-cli/src/template/README.md.tpl`
- Create: `apps/extension-cli/src/template/.github/workflows/release.yml`

- [ ] **Step 1: Repoint `@amiba/*` template deps to sdk-v1 tarball URLs**

In `apps/extension-cli/src/template/package.json.tpl`, replace the three `@amiba/*` entries in `devDependencies` (currently `"@amiba/extension-api": "*"`, `"@amiba/extension-cli": "*"`, `"@amiba/tailwind-preset": "*"`) with GitHub Release tarball URLs:

```json
    "@amiba/extension-api": "https://github.com/amiba-desktop/amiba/releases/download/sdk-v1/amiba-extension-api-0.1.0.tgz",
    "@amiba/extension-cli": "https://github.com/amiba-desktop/amiba/releases/download/sdk-v1/amiba-extension-cli-0.1.0.tgz",
    "@amiba/tailwind-preset": "https://github.com/amiba-desktop/amiba/releases/download/sdk-v1/amiba-tailwind-preset-0.1.0.tgz",
```

Leave every other dependency (react, react-dom, vite, tailwindcss, typescript, @types/*, etc.) unchanged.

- [ ] **Step 2: Remove the monorepo content path from the tailwind template**

Replace `apps/extension-cli/src/template/tailwind.config.cjs.tpl` entirely with (drop the `path` import and the `../../packages/ui` line — the template UI is plain React and doesn't reference `@amiba/ui` classes):

```js
const preset = require("@amiba/tailwind-preset")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: ["./src/ui/**/*.{ts,tsx,html}"],
}
```

- [ ] **Step 3: Add `apiVersion` to the manifest template**

In `apps/extension-cli/src/template/manifest.json.tpl`, add `"apiVersion": 1,` immediately after the `"version": "0.1.0",` line (matching the WS1 manifest convention).

- [ ] **Step 4: Add a README template**

Create `apps/extension-cli/src/template/README.md.tpl`:

```markdown
# {{NAME}}

A amiba desktop extension (`{{ID}}`).

## Develop

```bash
pnpm install            # installs the @amiba/* SDK from GitHub Release tarballs
pnpm amiba-ext dev   # watch-build; load it in the Hermes desktop app
```

## Build & package

```bash
pnpm build              # vite build (main + ui) → dist/
pnpm amiba-ext pack  # → extension.tgz
```

## Release

Push a `v*` tag; `.github/workflows/release.yml` builds, packs, and attaches
`extension.tgz` to the GitHub Release. Add the repo to the marketplace index to
make it installable from the desktop app.

> The SDK is consumed via tarball URLs pinned to `sdk-v1`
> (host extension-API level 1). `manifest.apiVersion` must be ≤ the desktop's
> implemented level or the extension is marked incompatible.
```

- [ ] **Step 5: Add the release workflow (copied verbatim — no `.tpl`)**

Create `apps/extension-cli/src/template/.github/workflows/release.yml`:

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm amiba-ext pack -o extension.tgz
      - uses: softprops/action-gh-release@v2
        with:
          files: extension.tgz
```

- [ ] **Step 6: Verify the template still scaffolds (dry, no install)**

Run: `node apps/extension-cli/dist/cli.js create _tmp_demo --id com.example.demo --no-install` (run from repo root; this writes `_tmp_demo/`). Then confirm the generated files are correct:
```bash
node -e "const p=require('./_tmp_demo/package.json'); const u=p.devDependencies['@amiba/extension-api']; if(!u.includes('sdk-v1')||!u.endsWith('.tgz')) throw new Error('api dep not tarball: '+u); console.log('scaffold deps ✓')"
node -e "const m=require('./_tmp_demo/manifest.json'); if(m.apiVersion!==1) throw new Error('apiVersion missing'); console.log('scaffold manifest ✓')"
grep -q "packages/ui" _tmp_demo/tailwind.config.cjs && { echo 'FAIL: monorepo path still present'; exit 1; } || echo "tailwind clean ✓"
test -f _tmp_demo/.github/workflows/release.yml && echo "release workflow ✓"
test -f _tmp_demo/README.md && echo "readme ✓"
```
Expected: all four ✓ lines. Then clean up: `rm -rf _tmp_demo`.

> Note: `apps/extension-cli/dist/cli.js` must be current — if Task 2 didn't rebuild it, run `pnpm -F @amiba/extension-cli build` first.

- [ ] **Step 7: Commit**

```bash
git add apps/extension-cli/src/template
git commit -m "feat(extension-cli): scaffold generates a standalone repo (tarball SDK deps, no monorepo paths, release workflow)"
```

---

## Task 5: End-to-end registry-free consumption check

A bash script that proves a scaffolded extension builds and packs against the **local** tarballs (standing in for the not-yet-published GitHub Release), with no registry access to `@amiba/*`.

**Files:**
- Create: `scripts/verify-scaffold.sh`

- [ ] **Step 1: Write the verification script**

Create `scripts/verify-scaffold.sh`:

```bash
#!/usr/bin/env bash
# Prove the create→install→build→pack loop works with NO registry:
# build local SDK tarballs, scaffold a demo extension, rewrite its tarball-URL
# deps to point at the local tarballs, then install + build + pack.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

echo "==> packing SDK tarballs"
bash scripts/sdk-pack.sh >/dev/null
API_TGZ="$ROOT/sdk-dist/amiba-extension-api-0.1.0.tgz"
CLI_TGZ="$ROOT/sdk-dist/amiba-extension-cli-0.1.0.tgz"
PRESET_TGZ="$ROOT/sdk-dist/amiba-tailwind-preset-0.1.0.tgz"
for f in "$API_TGZ" "$CLI_TGZ" "$PRESET_TGZ"; do test -f "$f" || { echo "missing $f"; exit 1; }; done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "==> scaffolding demo in $WORK"
( cd "$WORK" && node "$ROOT/apps/extension-cli/dist/cli.js" create demo --id com.example.demo --no-install )
EXT="$WORK/demo"

echo "==> rewriting tarball-URL deps → local file: paths"
node -e "
const fs=require('fs'), p='$EXT/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.devDependencies['@amiba/extension-api']='file:$API_TGZ';
j.devDependencies['@amiba/extension-cli']='file:$CLI_TGZ';
j.devDependencies['@amiba/tailwind-preset']='file:$PRESET_TGZ';
fs.writeFileSync(p, JSON.stringify(j,null,2));
"

echo "==> install (no workspace; isolated)"
( cd "$EXT" && pnpm install --ignore-workspace )
echo "==> build"
( cd "$EXT" && pnpm build )
test -f "$EXT/dist/main.cjs" || { echo "FAIL: dist/main.cjs missing"; exit 1; }
echo "==> pack"
( cd "$EXT" && pnpm amiba-ext pack -o extension.tgz )
test -f "$EXT/extension.tgz" || { echo "FAIL: extension.tgz missing"; exit 1; }

echo "✅ scaffold consumes local SDK tarballs end-to-end (install + build + pack)"
```

Make it executable: `chmod +x scripts/verify-scaffold.sh`.

- [ ] **Step 2: Run the verification**

Run: `bash scripts/verify-scaffold.sh`
Expected: ends with `✅ scaffold consumes local SDK tarballs end-to-end (install + build + pack)`.
If `pnpm install --ignore-workspace` errors on the `file:` tarballs, report the exact error as BLOCKED (it indicates a real consumability gap — likely a missing peer dep or a bad `exports` in one of the tarballs — which is exactly what this task exists to catch). Do not paper over it.

- [ ] **Step 3: Add the root script + commit**

In root `package.json` `scripts`, add `"sdk:verify-scaffold": "bash scripts/verify-scaffold.sh"`.
```bash
git add scripts/verify-scaffold.sh package.json
git commit -m "test(sdk): end-to-end scaffold consumption check against local tarballs"
```

---

## Task 6: Document the standalone-extension workflow

**Files:**
- Modify: `docs/marketplace-bootstrap.md`

- [ ] **Step 1: Add an "SDK distribution" section**

In `docs/marketplace-bootstrap.md`, add a section documenting the maintainer + author workflow. Use this content (place it near the existing publishing/flow sections):

```markdown
## SDK distribution (standalone extension repos)

Extensions can live in their own repos and build against the amiba SDK without
the monorepo. The SDK is distributed as GitHub Release tarballs (no public npm yet).

**Maintainer — cut an SDK release (once per API-level bump):**

```bash
pnpm sdk:pack            # → sdk-dist/amiba-{extension-api,tailwind-preset,extension-cli}-0.1.0.tgz
gh release create sdk-v1 sdk-dist/*.tgz   # tag MUST match the API level (sdk-v<HOST_API_VERSION>)
```

**Author — start a standalone extension:**

```bash
# with the published CLI tarball (or a local checkout of the monorepo CLI):
amiba-ext create my-ext --id com.example.my-ext
cd my-ext && pnpm install   # pulls @amiba/* from the sdk-v1 release tarballs
pnpm amiba-ext dev
```

The scaffold pins `@amiba/*` to `sdk-v1` tarball URLs and stamps
`manifest.apiVersion: 1`. Releasing the extension (`git tag v… && push`) runs the
generated `.github/workflows/release.yml`, which packs `extension.tgz` and attaches
it to the GitHub Release — ready to add to the marketplace index.

> Order matters: the `sdk-v1` release must exist before an extension repo's CI can
> `pnpm install` its tarball deps.

> Migrating to public npm later is a find-replace: swap the tarball URLs for version
> ranges (`^0.1.0`) once the packages are published. No other change needed.
```

- [ ] **Step 2: Commit**

```bash
git add docs/marketplace-bootstrap.md
git commit -m "docs: standalone extension repo workflow (sdk:pack → release → tarball deps)"
```

---

## Final Verification

- [ ] **Whole-suite + consumability gate**

Run, expecting all green:
```bash
pnpm -F @amiba/extension-host test
pnpm -F @amiba/extension-api exec tsc --noEmit
pnpm -F @amiba/extension-cli exec tsc --noEmit
pnpm sdk:pack
bash scripts/verify-scaffold.sh
```
Expected: 45 tests pass; both typechecks exit 0; `sdk-dist/` has the 3 tarballs; scaffold check ends with the ✅ line.

- [ ] **Cleanliness**

`git status` shows no stray `dist/`, `sdk-dist/`, or `_tmp_*` left tracked.

---

## Self-Review (done while writing)

- **Spec §4.1 (3 packages consumable):** Task 1 (extension-api build/publishConfig), Task 2 (extension-cli self-contained), Task 3 (tailwind-preset files). ✓ `@amiba/ui` explicitly out of scope per spec. ✓
- **Spec §4.2 (GitHub Release tarball, sdk-vN aligned to API level):** Task 3 `sdk:pack` → `sdk-v1` (= API_VERSION 1); Task 6 documents `gh release create sdk-v1`. ✓
- **Spec §4.3 (revise existing `create` scaffold):** Task 4 — tarball deps, drop monorepo tailwind path, `apiVersion`, README, release.yml. ✓
- **Spec §4.4 (CI validation; monorepo extensions stay workspace:\*; ui deferred):** Task 5 (verify-scaffold against local tarballs); Task 1 Step 6 confirms monorepo unaffected; ui untouched. ✓
- **Spec §8 risks addressed:** raw-TS build → Task 1; `workspace:*` not externable → Task 2 (devDeps move) + Task 1 (no @amiba dep); release-before-consume ordering → documented Task 6. ✓
- **Type/name consistency:** tarball filenames `amiba-<pkg>-0.1.0.tgz` (pnpm's scoped-name convention) used identically in sdk-pack.sh, verify-scaffold.sh, the template URLs (Task 4), and docs (Task 6). Release tag `sdk-v1` consistent across Tasks 3/4/6. `--pack-destination` used consistently. ✓
- **Placeholder scan:** every step has concrete code/commands; no TODO/TBD. ✓
- **Risk called out:** Task 5 Step 2 explicitly says a `pnpm install` failure on the tarballs is a real consumability gap to report as BLOCKED, not to paper over — that's the whole point of the gate.
