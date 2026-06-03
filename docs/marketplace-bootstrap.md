# Bootstrapping the Hermes-X Plugin Marketplace

This doc walks the **marketplace maintainer** (you) and **plugin authors** (anyone publishing a plugin) through the full end-to-end flow: where the marketplace index lives, how plugins build releases, how the desktop discovers and installs them.

## The pieces

| Repo | Purpose | Maintained by |
|---|---|---|
| `iHeyTang/hermes-x-marketplace` | Index repo. Contains exactly one file: `community-plugins.json` | Marketplace maintainer (curated; new entries via PR) |
| `<author>/hermes-x-ext-<name>` | One per plugin. Source + GitHub Releases | Plugin author |
| `iHeyTang/hermes-x` | This monorepo: desktop, extension-host, CLI | You |

Desktop fetches `community-plugins.json`, picks a plugin, calls GitHub Releases API on that plugin's repo, downloads `extension.tgz` from the latest release, extracts to `<userData>/extensions/<id>/`, hot-reloads.

## Step 1: Create the marketplace repo

```bash
gh repo create iHeyTang/hermes-x-marketplace --public --description "Hermes-X plugin marketplace index"
cd hermes-x-marketplace
cat > community-plugins.json <<'JSON'
[]
JSON
git add community-plugins.json
git commit -m "init: empty marketplace index"
git push
```

That's it for the repo. The desktop's default `HERMES_X_MARKETPLACE_INDEX_URL` is `https://raw.githubusercontent.com/iHeyTang/hermes-x-marketplace/main/community-plugins.json` — it'll start returning 200 with `[]` as soon as you push.

### `community-plugins.json` schema

```jsonc
[
  {
    "id": "io.hermes.knowledge-base",       // must match the plugin's manifest.json `id`
    "name": "Knowledge Base",                // human-readable
    "description": "GBrain-backed personal knowledge base", // optional
    "author": "iHeyTang",                    // optional
    "repo": "iHeyTang/hermes-x-ext-knowledge-base", // owner/repo on GitHub
    "version": "0.1.0",                       // optional; omit for "latest release"
    "sha256": "..."                           // optional; tarball checksum
  }
]
```

When you accept a plugin PR:
1. The PR adds one entry.
2. CI (optional, see §3) verifies the `repo` actually has a release with `extension.tgz`.
3. Merge → desktop instances see the new plugin next time they hit Browse.

## Step 2: Plugin author's workflow

A plugin lives in its own GitHub repo (e.g. `iHeyTang/hermes-x-ext-knowledge-base`).

### Initial scaffold

```bash
npm install -g @hermes-x/extension-cli
hermes-x-ext create my-plugin
cd my-plugin
git init && git add . && git commit -m "initial"
gh repo create <author>/hermes-x-ext-my-plugin --public --source=.
git push -u origin main
```

### Cutting a release

Manually:

```bash
hermes-x-ext build       # produces dist/main.cjs + dist/renderer.js
hermes-x-ext pack        # produces extension.tgz
gh release create v0.1.0 extension.tgz \
  --title "v0.1.0" \
  --notes "First release"
```

Or via GitHub Actions — drop this in `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - run: pnpm install --frozen-lockfile
      - run: npx hermes-x-ext build
      - run: npx hermes-x-ext pack
      - run: |
          gh release create "${GITHUB_REF#refs/tags/}" extension.tgz \
            --title "${GITHUB_REF#refs/tags/}" \
            --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
```

Tag + push → release with `extension.tgz` attached → marketplace's `resolveRelease` finds it → desktop installs it.

### Submitting to the marketplace

Open a PR on `iHeyTang/hermes-x-marketplace` adding one entry to `community-plugins.json`. The marketplace maintainer reviews + merges.

## Step 3: Suggested CI on the marketplace repo

To catch malformed entries before they ship to users, add `.github/workflows/validate.yml` to `hermes-x-marketplace`:

```yaml
name: Validate
on:
  pull_request:
    paths: ["community-plugins.json"]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Validate JSON
        run: |
          node -e "JSON.parse(require('fs').readFileSync('community-plugins.json', 'utf8'))"
      - name: Verify each entry has a release with extension.tgz
        run: |
          for repo in $(jq -r '.[].repo' community-plugins.json); do
            echo "Checking $repo…"
            url="https://api.github.com/repos/$repo/releases/latest"
            asset=$(curl -fsSL "$url" | jq -r '.assets[] | select(.name=="extension.tgz") | .name')
            if [ "$asset" != "extension.tgz" ]; then
              echo "::error::$repo has no latest release with extension.tgz"
              exit 1
            fi
          done
        env:
          GH_TOKEN: ${{ github.token }}
```

## Step 4: SHA256 pinning (optional but recommended)

If a marketplace entry has `sha256` set, the desktop verifies the downloaded `extension.tgz` against it and refuses to install on mismatch. This pins the binary against silent release-asset swaps.

Compute the hash:

```bash
shasum -a 256 extension.tgz
```

Add to the marketplace entry:

```jsonc
{
  "id": "...",
  "repo": "...",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

The CLI's `install` command also supports `--sha256` for ad-hoc installs:

```bash
hermes-x-ext install owner/repo@v1.2.3 --sha256 e3b0c44298fc1c...
```

## Local dev / testing flows

### Flow A: develop a plugin against the running desktop

```bash
cd hermes-x-ext-my-plugin
hermes-x-ext dev
```

Builds + symlinks `<userData>/extensions/<id>/` to the plugin's cwd, watches `dist/`, touches manifest on each rebuild. Desktop picks up the change and hot-reloads (`extensions/<id>/manifest.json` mtime triggers `reloadExtension(id)`).

### Flow B: test the marketplace install path without a real GitHub repo

Point the desktop at a local marketplace index:

```bash
# Serve a local community-plugins.json
mkdir /tmp/fake-marketplace
cat > /tmp/fake-marketplace/community-plugins.json <<'JSON'
[
  {
    "id": "io.hermes.knowledge-base",
    "name": "Knowledge Base (LOCAL)",
    "repo": "iHeyTang/hermes-x-ext-knowledge-base"
  }
]
JSON
python3 -m http.server --directory /tmp/fake-marketplace 8000 &

# Start desktop with the override
HERMES_X_MARKETPLACE_INDEX_URL=http://localhost:8000/community-plugins.json \
  pnpm dev:desktop
```

Now `Settings → Extensions → Browse` fetches your local index. The install button still hits GitHub for the actual `extension.tgz` (because the `repo` field points at GitHub), so this flow tests the *list* path but not the *install* path end-to-end. For the latter, see Flow C.

### Flow C: full end-to-end against a fake release server

To exercise the install path without publishing to GitHub, you need to fake the GitHub Releases API too. That's beyond the scope of this doc — the simplest path is:

1. Push a `v0.1.0` tag to a throwaway GitHub repo.
2. Run `hermes-x-ext pack`.
3. `gh release create v0.1.0 extension.tgz --repo owner/throwaway-repo`.
4. Point your local marketplace at it (`"repo": "owner/throwaway-repo"`).

This is exactly the production flow; you've just used a throwaway repo for the binding.

## Recap

```
                      ┌─────────────────────────────────┐
                      │ iHeyTang/hermes-x-marketplace   │
                      │  └── community-plugins.json     │
                      └──────────────┬──────────────────┘
                                     │ raw.githubusercontent.com
                                     ▼
   ┌─────────────────────┐    ┌─────────────────────────┐
   │ Plugin author       │    │ Hermes-X Desktop        │
   │  └── hermes-x-ext   │    │  └── Browse tab         │
   │      pack/release   │    │      → install()        │
   └─────────┬───────────┘    └──────────────┬──────────┘
             │ gh release create              │ api.github.com/.../releases/latest
             ▼                                ▼
   ┌────────────────────────────────────────────────────┐
   │ <author>/hermes-x-ext-<name>                       │
   │  └── Releases/v0.1.0/                              │
   │      └── extension.tgz                             │
   └────────────────────────────────────────────────────┘
```
