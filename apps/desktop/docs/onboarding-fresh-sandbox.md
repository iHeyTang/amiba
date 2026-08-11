# Fresh Runtime sandbox

Exercise first-launch writable state and automatic built-in Runtime startup
without touching the user's system Hermes, `~/.hermes`, or launchd service:

```bash
pnpm dev:desktop:fresh        # ephemeral; removed on exit
pnpm dev:desktop:fresh:keep   # persistent; reuses sandboxed user data
```

The harness is macOS-only and lives at
[`scripts/fresh-desktop.sh`](../../../scripts/fresh-desktop.sh).

## Isolation model

The script creates a sandbox HOME and exports:

```text
AMIBA_HERMES_USER_DATA_DIR=<sandbox>/amiba-user-data
```

Amiba executes the built-in Runtime directly and writes only `HERMES_HOME` data
below that directory. A `hermes` on PATH and a running system gateway on the
conventional 8642/9394 ports are irrelevant. Amiba's sandboxed
gateway/backplane use 18642/19394.

The script no longer stops or restarts `ai.hermes.gateway`; managed-runtime
isolation makes that unnecessary.

## Modes

- `fresh` creates a temporary writable `HERMES_HOME` and removes it on exit.
- `fresh:keep` uses `~/.hermes-fresh-sandbox` so configuration and sessions
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
