# Amiba-managed Hermes runtime

Amiba Desktop ships Hermes inside each platform installer. End-user machines do
not need a `hermes` command on PATH and do not clone source or resolve Python /
Node dependencies.

## Release flow

`pnpm --filter @amiba/desktop package` runs `runtime:prepare` before the normal
Electron build. The preparation step:

1. fetches the exact Hermes commit from `hermes-runtime-manifest.json`;
2. installs the pinned relocatable CPython distribution;
3. resolves the locked Hermes Python dependencies into that interpreter;
4. downloads and checksum-verifies the pinned official Node distribution;
5. installs Hermes Node dependencies and Playwright Chromium;
6. smoke-tests `hermes --help` with the bundled interpreter;
7. writes the result to `resources/hermes-runtime` for `electron-builder` to
   copy into the application resources.

Runtime preparation requires network access only on the release builder. A
valid existing artifact is reused. Use `--force` or
`AMIBA_HERMES_RUNTIME_REBUILD=1` for a clean rebuild.

The artifact contains native wheels and executables, so every release job must
build one OS/architecture pair. Produce macOS arm64, macOS x64, Windows x64,
Linux x64, and any additional supported architecture in separate CI jobs.

## User-machine flow

On first setup Amiba validates the embedded marker, copies the bundle atomically
into Electron `userData`, initializes the private `HERMES_HOME`, and starts the
interactive `hermes setup` screen. This is a local file operation; no source or
dependency download occurs.

```text
<Electron userData>/hermes/
├── home/                                      # durable user data/config
└── runtimes/
    └── <commit>-bundle-v<schema>/
        ├── runtime-manifest.json
        ├── python/                            # relocatable CPython + deps
        ├── node/                              # official Node distribution
        ├── browsers/                          # Playwright Chromium
        └── hermes-agent/                      # exact pinned source snapshot
```

The runtime directory changes with the Hermes commit or bundle schema, while
`home/` remains stable. This gives Amiba side-by-side upgrades and rollback
without modifying system Hermes or `~/.hermes`.

## Local development and Hermes joint debugging

Prepare a runtime once, then start the desktop normally:

```bash
pnpm --filter @amiba/desktop runtime:prepare
pnpm dev:desktop
```

To modify Hermes and Amiba together, point Amiba at a live Hermes checkout:

```bash
pnpm --filter @amiba/desktop runtime:prepare:local
pnpm --filter @amiba/desktop dev:hermes
```

`dev:hermes` defaults to the sibling `hermes-agent` repository and sets
`AMIBA_HERMES_DEV_SOURCE` to its absolute path. Amiba continues to use the
private bundled Python/dependency runtime but executes the live checkout's
`hermes` entrypoint. Python source edits therefore take effect after restarting
the supervised gateway; dependency changes require rerunning
`runtime:prepare:local`.

For a non-standard checkout:

```bash
AMIBA_HERMES_DEV_SOURCE=/absolute/path/to/hermes-agent \
  pnpm --filter @amiba/desktop dev:hermes
```

The release `package` command never honors this development source override. It
always fetches and verifies the manifest commit.

## Version source of truth

`hermes-runtime-manifest.json` pins Hermes, Python, Node, Playwright, the bundle
schema, and Amiba's private ports. `src/main/managed-hermes-runtime.ts`
validates and consumes that manifest. Updating Hermes is a reviewed Amiba
release change; in-place `hermes update` remains disabled.

Amiba does not silently copy `~/.hermes`. Messaging tokens, cron jobs, active
gateway state, and plugins need an explicit import flow to avoid duplicate
workers.
