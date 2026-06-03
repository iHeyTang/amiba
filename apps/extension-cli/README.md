# @hermes-x/extension-cli

CLI for developing and distributing Hermes Desktop extensions.

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

### `hermes-x-ext dev`

Build the extension in watch mode and sideload it into the running desktop app.
The command symlinks the current directory into `<userData>/extensions/<id>/`
and uses `fs.watch` on `dist/` to touch `manifest.json` whenever `main.cjs` or
`renderer.js` change — triggering the desktop's hot-reload path automatically.

```sh
hermes-x-ext dev
```

Options:

| Flag | Description |
|------|-------------|
| `--no-symlink` | Copy files instead of symlinking (not yet implemented) |

### `hermes-x-ext build`

Production build (single run, no watch).

```sh
hermes-x-ext build
```

### `hermes-x-ext pack`

Produce `extension.tgz` ready for attaching to a GitHub Release.

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
