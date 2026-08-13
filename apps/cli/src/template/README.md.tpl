# {{NAME}}

An Amiba Applet (`{{ID}}`).

## Develop

```bash
pnpm install            # installs the @amiba/* SDK from GitHub Release tarballs
pnpm dev                # watch-build; load it from Amiba → Settings → Applets
```

> **First install:** pnpm may prompt `approve-builds` for `esbuild` (bundled with Vite). Run `pnpm approve-builds`, or add `onlyBuiltDependencies=["esbuild"]` to a project `.npmrc`, to suppress it.

The Applet is the lifecycle root for every capability it contributes. Declare
UI under `contributes`, Composer resource projections under `mentions`, and
low-level Agent dependencies under `hermesPlugins` in `manifest.json`.

## Build & package

```bash
pnpm build              # vite build (main + ui) -> dist/
pnpm pack               # -> extension.tgz
```

## Release

Push a `v*` tag; `.github/workflows/release.yml` builds, packs, and attaches
`extension.tgz` to the GitHub Release. Add the repo to the marketplace index to
make it installable from the desktop app.

> The SDK is consumed via tarball URLs pinned to `sdk-v1` (host extension-API
> level 1). `manifest.apiVersion` must be <= the desktop's implemented level or
> the Applet is marked incompatible.
