# Onboarding Fresh-Sandbox

How to exercise the desktop onboarding wizard end-to-end on a machine that
already has hermes installed, without touching the real install or the
launchd-managed gateway.

Entry points:

```bash
pnpm dev:desktop:fresh        # ephemeral: full install every run, wiped on exit
pnpm dev:desktop:fresh:keep   # persistent sandbox at ~/.hermes-fresh-sandbox
```

Script: [`scripts/fresh-desktop.sh`](../../../scripts/fresh-desktop.sh) (macOS only).

## Why this exists

The desktop boot path decides whether to show the wizard from two probes
(`apps/desktop/src/renderer/App.tsx:115`):

1. `getHermesStatus()` — HTTP probe against `http://127.0.0.1:9394`. If it
   answers, jump straight to Home.
2. Otherwise the wizard mounts and calls `detectHermes()`
   (`apps/desktop/src/main/hermes-runtime.ts:155`) which runs
   `hermes --version` against this candidate list:

   ```
   hermes                        (resolved via PATH)
   $HOME/.local/bin/hermes
   $HOME/.cargo/bin/hermes
   /opt/homebrew/bin/hermes
   /usr/local/bin/hermes
   ```

   Any exit-0 → `installed: true`, wizard skips install step.

On a developer machine both probes succeed, so the wizard is unreachable.
Uninstalling to test would nuke the real environment. The script instead
creates a temporary "view" of the machine where both probes fail.

## Mode comparison

| Aspect | `fresh` (default) | `fresh:keep` |
|---|---|---|
| `HOME` | `mktemp -d -t hermes-fresh` | `~/.hermes-fresh-sandbox` |
| Cleanup | `rm -rf` the sandbox on exit | Sandbox preserved |
| Second launch | Re-downloads + re-installs (~30s, hundreds of MB) | Reuses install, hides binary so wizard re-fires |
| Use case | Validate real install script, simulate a true first-run user | Iterate on wizard UI/copy without re-downloading |

## How the sandbox tricks each probe

1. **Backplane port (probe 1).** `launchctl bootout gui/$UID/ai.hermes.gateway`
   stops the launchd-managed gateway. The plist file under
   `~/Library/LaunchAgents/` is **not** removed; this is a pause, not an
   uninstall. On exit the script runs `launchctl bootstrap` to reattach it.
   With nothing on 9394, `getHermesStatus()` returns not-ok.
2. **Binary detection (probe 2).** Two env tweaks make every candidate miss:
   - `HOME=$SANDBOX` so the two `$HOME/...` candidates resolve to an empty
     directory.
   - `PATH=/usr/bin:/bin:/usr/sbin:/sbin` so the `hermes` candidate (PATH
     lookup) cannot find `~/.local/bin/hermes`.
   - `/opt/homebrew/bin/hermes` and `/usr/local/bin/hermes` are absolute
     and HOME-independent; on this codebase's typical dev box they are
     not present. If they ever are, the script must be extended to
     temporarily rename them.
3. **Install runs into the sandbox.** When the wizard invokes
   `bash -c "curl ... install.sh | bash"`, the child process inherits
   `HOME=$SANDBOX`, so install.sh writes `$SANDBOX/.local/bin/hermes`,
   `$SANDBOX/.hermes/...`, `$SANDBOX/.bashrc`, etc. The real `~/.hermes/`
   is never touched.
4. **Gateway started by the wizard is short-lived.** `startBackplane` in
   `apps/desktop/src/main/hermes-runtime.ts` spawns `hermes gateway`
   (not `hermes gateway install`), so launchd is not modified. The child
   process dies when the dev server exits, freeing 9394 for the launchd
   restore.

## Keep-mode binary hiding

On the second `fresh:keep` launch the sandbox already contains an
installed hermes, so detection would succeed and skip the wizard. The
script renames `$SANDBOX/.local/bin/hermes` to `hermes.fresh-bak` before
launching and restores it during cleanup. This forces the wizard to
re-mount without re-running install.

## Cleanup contract

A single `trap cleanup EXIT INT TERM` covers Ctrl+C, normal exit, and
external `kill`:

- Ephemeral mode: `rm -rf "$SANDBOX"`.
- Keep mode: `mv hermes.fresh-bak hermes` if the rename happened.
- Always: `launchctl bootstrap gui/$UID <plist>` if `bootout` succeeded
  earlier. The `BOOTED_OUT` flag prevents re-attaching something the user
  had manually disabled before running the script.

## Known limits & extension points

- macOS only. Linux equivalent would swap `launchctl` for
  `systemctl --user`; Windows would need Scheduled Task handling. Guarded
  with a `uname` check at the top of the script.
- Assumes the launchd label is `ai.hermes.gateway`. If the upstream
  installer changes the label, update `LABEL=` in the script.
- Assumes only `~/.local/bin/hermes` exists on disk. If a contributor's
  machine also has hermes under `/opt/homebrew` or `/usr/local`, the
  script needs to add a temporary-rename step for those absolute paths.
- Pre-launch warning: if `lsof -iTCP:9394` still shows a listener after
  `bootout`, something else owns the port (another dev server, a stale
  `hermes gateway`). The wizard would then silently skip itself.
- The dev server is launched via `exec pnpm dev:desktop` so signal
  propagation and the `trap` both behave predictably; do not wrap it in
  a subshell.
