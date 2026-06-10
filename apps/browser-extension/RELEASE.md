# Release Guide

How to ship a new version of the Hermes Browser Extension.

Distribution model: **GitHub Releases sideload** — the extension source lives
here in the monorepo (`apps/browser-extension`, built with Plasmo); the built
`.zip` is published as a GitHub Release on the dedicated distribution repo
[`amiba-desktop/amiba-browser-extension`](https://github.com/amiba-desktop/amiba-browser-extension).
The GitHub Pages download page at
`https://iheytang.github.io/amiba-browser-extension/` auto-picks up the
latest release via the GitHub Releases API. No Chrome Web Store submission —
that path is deferred until / if we ever want it.

## Cutting a release

All steps run from the **monorepo root** (`amiba-desktop/amiba`):

```bash
# 1. Bump version in the browser-extension package.json
$EDITOR apps/browser-extension/package.json   # change "version": "X.Y.Z"

# 2. Build + package
pnpm -F @amiba/browser-extension build
pnpm -F @amiba/browser-extension package
# Produces the packaged zip (check pnpm output for exact path).
# If `package` is not a defined script, zip manually:
#   cd apps/browser-extension/build/chrome-mv3-prod
#   zip -r ../../hermes-extension-vX.Y.Z.zip .

# 3. Commit + tag in the monorepo
git commit -am "chore: bump browser-extension to vX.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z

# 4. Publish the zip as a GitHub Release on the dist repo
gh release create vX.Y.Z apps/browser-extension/build/hermes-extension-vX.Y.Z.zip \
  -R amiba-desktop/amiba-browser-extension \
  --title "Hermes Browser Extension vX.Y.Z" \
  --generate-notes
```

When step 4 completes, the release is at
`https://github.com/amiba-desktop/amiba-browser-extension/releases/tag/vX.Y.Z`
with `hermes-extension-vX.Y.Z.zip` attached. The download page
auto-picks it up on next page-load (it queries the GitHub Releases API).

## Smoke test the release zip before announcing

```bash
# Download the asset just published
gh release download vX.Y.Z -p '*.zip' -R amiba-desktop/amiba-browser-extension
unzip hermes-extension-vX.Y.Z.zip -d /tmp/hermes-ext-test

# Load in Chrome
# - chrome://extensions/
# - Developer mode ON
# - Load unpacked → /tmp/hermes-ext-test
# - Side panel opens, Status tab shows backplane (if running)
```

If smoke test fails, the right move is **delete the GitHub release** on the
dist repo (`amiba-desktop/amiba-browser-extension`), fix the source here,
bump to the next patch version, and re-tag — Chrome users who already
downloaded won't auto-update without manual action anyway, so a yanked zip
just stops new installs.

## Manual build (when you need a local zip without tagging)

```bash
cd apps/browser-extension
pnpm install --frozen-lockfile
pnpm build
cd build/chrome-mv3-prod && zip -r ../../hermes-extension-dev.zip .
```

Output: `apps/browser-extension/hermes-extension-dev.zip` (about 7 MB).

## Future: swap to a self-hosted artifact registry

The download page reads its release source from a single config block at
the top of the dist repo's [`docs/index.html`](https://github.com/amiba-desktop/amiba-browser-extension/blob/main/docs/index.html).
To point users at your own host instead of GitHub Releases:

1. Set up your registry to serve a `latest.json` manifest like:
   ```json
   {
     "version": "0.4.0",
     "released_at": "2026-08-01T12:00:00Z",
     "zip_url": "https://your-host.example.com/hermes-extension-v0.4.0.zip",
     "size_bytes": 7340032,
     "sha256": "..."
   }
   ```
2. In the dist repo's `docs/index.html`, change the `RELEASE_SOURCE` block from
   `type: 'github'` to `type: 'custom'` with `manifestUrl` pointing at
   your `latest.json`.
3. (Optional) Extend the release step to also push to your registry.

The download page UI doesn't care about the source as long as
`getLatestRelease()` resolves to `{ version, zipUrl, releasedAt, sizeBytes? }`.

## Common gotchas

- **Forgot to bump version in `package.json`** → The zip inside has the wrong
  version. Manifest version mismatch surfaces in `chrome://extensions/` for
  sideload users (they'll see the old number even after "reload").
- **Bundle size > 10 MB** → Chrome refuses to load. Run
  `du -sh apps/browser-extension/build/chrome-mv3-prod/` before tagging.
  Usually means unbundled fonts or images.
- **Service worker takes too long to register** → Manifest v3 caps SW
  startup at 30s. If hit, lazy-load heavy modules.
- **GitHub Pages 404 on the download page** → After enabling Pages on the
  dist repo (settings → Pages → source = `main` branch, folder = `/docs`),
  give it a minute to publish; check the "Environments" tab for deploy status.
