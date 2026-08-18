# Fresh DSH runtime sandbox

Exercise first-launch writable state and automatic managed DSH startup without
touching the user's normal Amiba data or any system DSH installation:

```bash
pnpm dev:desktop:fresh        # ephemeral; removed on exit
pnpm dev:desktop:fresh:keep   # persistent; reuses sandboxed user data
```

The harness is macOS-only and lives at
[`scripts/fresh-desktop.sh`](../../../scripts/fresh-desktop.sh).

## Isolation model

The script creates a sandbox HOME and exports:

```text
AMIBA_USER_DATA_DIR=<sandbox>/amiba-user-data
```

Amiba launches the bundled, pinned DSH process directly. Desktop state and the
managed DSH home both resolve below the overridden user-data directory. A
separate `dsh` executable on `PATH` is ignored; DSH binds an ephemeral loopback
port and authenticates Amiba's private plugin endpoints with a per-launch token.

## Modes

- `fresh` creates a temporary writable home and removes it on exit.
- `fresh:keep` uses `~/.amiba-dsh-fresh-sandbox` so configuration and sessions
  survive subsequent launches. Both modes execute the same built-in Runtime.

Both modes preserve the normal pnpm/node paths required by the development
server while excluding user-local package-manager bins from the child PATH.
Run `pnpm runtime:prepare` once from the repository root before using the
harness; `runtime:verify` fails early when the platform bundle is missing.

## Recovery

The cleanup trap removes only an ephemeral sandbox. If a terminal or Electron
process is killed before the trap runs, use:

```bash
pnpm dev:desktop:fresh:reset
```

Pass `--all` through the reset script directly to remove the persistent sandbox.
