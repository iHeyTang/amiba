# @amiba/cli

The **amiba CLI** (command: `amiba`) — scaffolding and tooling for the amiba ecosystem. It
started as the extension CLI and has grown beyond that; today it covers:

- **Extensions** — scaffold / dev / build / pack / install desktop extensions
  (the WebView model: `manifest.json` + `dist/main.cjs` + self-contained React
  UI pages served via `hermes-ext://` into an Electron `<webview>`).
- **Mention sources** — scaffold a composer `@`-mention source
  (`create-mention-source`).

## Installation

```sh
pnpm add -g @amiba/cli   # installs the `amiba` command
# or, from a local checkout:
node apps/cli/dist/cli.js --help
```

## Commands

### `amiba create [name]`

Scaffold a new desktop **extension** from the built-in template.

```sh
amiba create my-extension --id com.example.my-extension
```

### `amiba create-mention-source [name]`

Scaffold a **mention source** — a composer `@`-mention provider for an external
system. Produces the four-piece source (`source.py` + `mention-source.yaml` +
`skills/resolve.md` + `__init__.py`) as a ready git repo.

```sh
amiba create-mention-source notion --description "Notion pages"
```

See `backend/docs/mention-sources.md` for the author guide.

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

### `amiba dev`

Build the extension in watch mode. Spawns two parallel Vite watch processes
(main + UI) and touches `manifest.json` on any output change so the running
desktop app hot-reloads the extension automatically.

```sh
amiba dev
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

### `amiba build`

Production build — runs `vite build -c vite.main.config.ts` followed by
`vite build -c vite.ui.config.ts`. Validates `manifest.json` first.

```sh
amiba build
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

### `amiba pack`

Produce `extension.tgz` ready for attaching to a GitHub Release.
Tarballs `manifest.json` + `dist/` (which contains `main.cjs` and
`ui/<surface>/index.html`).

```sh
amiba pack
amiba pack -o dist/extension.tgz
```

Options:

| Flag | Description |
|------|-------------|
| `-o, --output <path>` | Output tarball path (default: `extension.tgz`) |

### `amiba install <repo>`

Install an extension directly from a GitHub Release into
`<userData>/extensions/<id>/`.

```sh
# Install the latest release
amiba install owner/repo

# Install a specific tag
amiba install owner/repo@v1.2.3

# Install and verify the tarball checksum
amiba install owner/repo --sha256 <hex>
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

If Amiba Desktop is running, it will hot-reload the newly installed extension
automatically via its manifest-watcher.

The install path honours the `AMIBA_DEV_EXTENSIONS_PATH` environment variable
(same override the desktop itself uses).

This command re-implements the GitHub-release-to-disk flow in pure Node rather
than delegating to `@amiba/extension-host/main`, which depends on Electron
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
