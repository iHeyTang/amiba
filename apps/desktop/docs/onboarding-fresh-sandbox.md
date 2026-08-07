# Onboarding fresh sandbox

Exercise the managed-runtime onboarding flow without touching the user's system
Hermes, `~/.hermes`, or launchd service:

```bash
pnpm dev:desktop:fresh        # ephemeral; removed on exit
pnpm dev:desktop:fresh:keep   # persistent; reuses the bundled runtime copy
```

The harness is macOS-only and lives at
[`scripts/fresh-desktop.sh`](../../../scripts/fresh-desktop.sh).

## Isolation model

The script creates a sandbox HOME and exports:

```text
AMIBA_HERMES_USER_DATA_DIR=<sandbox>/amiba-user-data
```

Amiba then copies its bundled runtime below that directory. Desktop discovery
checks only the manifest-derived managed binary, so a `hermes` on PATH and a
running system gateway on the conventional 8642/9394 ports are irrelevant.
Amiba's sandboxed gateway/backplane use 18642/19394.

The script no longer stops or restarts `ai.hermes.gateway`; managed-runtime
isolation makes that unnecessary.

## Modes

- `fresh` creates a temporary sandbox, runs the real embedded-bundle copy and
  setup flow, and removes the sandbox on exit.
- `fresh:keep` uses `~/.hermes-fresh-sandbox`. On subsequent launches it
  temporarily renames the managed runtime interpreter so onboarding mounts
  again. The embedded bundle is copied back locally; no network is used.

Both modes preserve the normal pnpm/node paths required by the development
server while excluding user-local package-manager bins from the child PATH.
Run `pnpm --filter @amiba/desktop runtime:prepare` once before using the
harness; `runtime:verify` fails early when the platform bundle is missing.

## Recovery

The cleanup trap restores a hidden binary and removes only an ephemeral
sandbox. If a terminal or Electron process is killed before the trap runs, use:

```bash
pnpm dev:desktop:fresh:reset
```

The reset helper remains backward-compatible with older harness runs that
temporarily stopped the launchd gateway.
