# @hermes-x/extension-cli

CLI for developing and distributing Hermes Desktop extensions.

Extensions follow the **WebView model**: each UI surface (sidebar, settings, etc.)
is an independent HTML page served via the `hermes-ext://` protocol into an
Electron `<webview>`. Extensions ship `manifest.json` + `dist/main.cjs` (Node/main
process) + `dist/ui/<surface>/index.html` (self-contained React pages).

## Installation

```sh
pnpm add -g @hermes-x/extension-cli
# or, from a local checkout:
node apps/extension-cli/dist/cli.js --help
```

## Commands

### `hermes-x-ext create [name]`

Scaffold a new extension from the built-in template.

```sh
hermes-x-ext create my-extension --id com.example.my-extension
```

The scaffold produces:

```
my-extension/
├── manifest.json          # declares sidebarViews + settingsTabs
├── package.json
├── tsconfig.json
├── vite.main.config.ts    # builds src/main → dist/main.cjs
├── vite.ui.config.ts      # builds src/ui/* → dist/ui/*/index.html
└── src/
    ├── main/index.ts      # activate(host) — registers IPC handlers
    ├── ui/
    │   ├── shared/
    │   │   ├── hermes-bridge.ts   # typed window.hermes re-export
    │   │   └── styles.css
    │   ├── sidebar/
    │   │   ├── index.html
    │   │   ├── main.tsx
    │   │   └── App.tsx
    │   └── settings/
    │       ├── index.html
    │       ├── main.tsx
    │       └── App.tsx
    └── i18n/
        ├── en.json
        └── zh-CN.json
```

### `hermes-x-ext dev`

Build the extension in watch mode. Spawns two parallel Vite watch processes
(main + UI) and touches `manifest.json` on any output change so the running
desktop app hot-reloads the extension automatically.

```sh
hermes-x-ext dev
```

Recommended workflow:

1. Terminal 1: `pnpm dev:desktop`
2. Terminal 2: `cd <extension dir> && pnpm dev`
3. In the app: **Settings → Extensions → Add local extension…** → pick the
   extension directory. Every rebuild hot-reloads from then on.

Options:

| Flag | Description |
|------|-------------|
| `--no-symlink` | Accepted for backward compatibility; has no effect |

### `hermes-x-ext build`

Production build — runs `vite build -c vite.main.config.ts` followed by
`vite build -c vite.ui.config.ts`. Validates `manifest.json` first.

```sh
hermes-x-ext build
```

Output:

```
dist/
├── main.cjs                  # Node/main-process bundle
├── main.cjs.map
└── ui/
    ├── sidebar/index.html    # self-contained React page
    ├── settings/index.html   # self-contained React page
    └── assets/               # shared JS chunks
```

### `hermes-x-ext pack`

Produce `extension.tgz` ready for attaching to a GitHub Release.
Tarballs `manifest.json` + `dist/` (which contains `main.cjs` and
`ui/<surface>/index.html`).

```sh
hermes-x-ext pack
hermes-x-ext pack -o dist/extension.tgz
```

Options:

| Flag | Description |
|------|-------------|
| `-o, --output <path>` | Output tarball path (default: `extension.tgz`) |

### `hermes-x-ext install <repo>`

Install an extension directly from a GitHub Release into
`<userData>/extensions/<id>/`.

```sh
# Install the latest release
hermes-x-ext install owner/repo

# Install a specific tag
hermes-x-ext install owner/repo@v1.2.3

# Install and verify the tarball checksum
hermes-x-ext install owner/repo --sha256 <hex>
```

Arguments:

| Argument | Description |
|----------|-------------|
| `<repo>` | GitHub repository as `owner/repo`, optionally with `@tag` |

Options:

| Flag | Description |
|------|-------------|
| `--sha256 <hex>` | Verify the downloaded `extension.tgz` against this SHA-256 hex digest |

The command:

1. Fetches the GitHub Release (latest, or the pinned tag).
2. Locates the `extension.tgz` asset attached to that release.
3. Downloads the tarball and optionally verifies its SHA-256.
4. Extracts and validates `manifest.json` at the archive root.
5. Moves the directory into `<userData>/extensions/<id>/`.

If Hermes Desktop is running, it will hot-reload the newly installed extension
automatically via its manifest-watcher.

The install path honours the `HERMES_X_DEV_EXTENSIONS_PATH` environment variable
(same override the desktop itself uses).

This command re-implements the GitHub-release-to-disk flow in pure Node rather
than delegating to `@hermes-x/extension-host/main`, which depends on Electron
and is therefore unavailable in a plain Node CLI process.

## Extension architecture

```
Desktop (Electron)
└── ExtensionWebView src="hermes-ext://<id>/dist/ui/sidebar/index.html"
        │  served by ext-protocol handler → reads from extension root on disk
        │
        └── React page
                └── window.hermes  (injected by webview-bridge preload)
                        ├── hermes.ipc.invoke(channel, args)
                        ├── hermes.settings.get/set(key, value)
                        └── hermes.on("language" | "theme", cb)
```

The `hermes-ext://` protocol resolves `<id>/<relative-path>` to
`<extensionRoot>/<relative-path>`, so paths in `manifest.json` like
`"view": "dist/ui/sidebar/index.html"` map directly to the file on disk.
