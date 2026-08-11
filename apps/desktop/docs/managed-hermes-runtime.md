# Amiba-managed Hermes runtime

Amiba Desktop ships Hermes inside each platform installer. End-user machines do
not need a `hermes` command on PATH and do not clone source or resolve Python /
Node dependencies.

## Release flow

`pnpm package:desktop` runs `runtime:prepare` before the normal
Electron build. The preparation step:

1. fetches the exact Hermes commit from `hermes-runtime-manifest.json`;
2. checksum-verifies the Amiba-owned patch and verifier files;
3. installs the pinned relocatable CPython distribution, Hermes dependencies,
   and Amiba Backplane;
4. runs every behavioral verifier against the unpatched source to detect
   functionality that has already landed upstream;
5. applies required patches only to the temporary source snapshot and verifies
   the resulting behavior again;
6. downloads and checksum-verifies the pinned official Node distribution;
7. installs Hermes Node dependencies and Playwright Chromium;
8. smoke-tests Hermes and the bundled Backplane with the bundled interpreter;
9. writes the result to `resources/hermes-runtime` for `electron-builder` to
   copy into the application resources.

Runtime preparation requires network access only on the release builder. A
valid existing artifact is reused. Run `pnpm runtime:rebuild` from the
repository root, or set `AMIBA_HERMES_RUNTIME_REBUILD=1`, for a clean rebuild.

The artifact contains native wheels and executables, so every release job must
build one OS/architecture pair. Produce macOS arm64, macOS x64, Windows x64,
Linux x64, and any additional supported architecture in separate CI jobs.

## User-machine flow

Amiba validates the embedded marker and executes that immutable Runtime directly
from application resources. First launch creates only the private writable
`HERMES_HOME`; it never copies Runtime code and never installs Python packages.

```text
<application resources>/hermes-runtime/        # immutable, executed directly
├── runtime-manifest.json
├── python/                                    # CPython + Hermes + Backplane
├── node/                                      # official Node distribution
├── browsers/                                  # Playwright Chromium
└── hermes-agent/                              # pinned source snapshot

<Electron userData>/hermes/home/               # mutable and durable
├── .env
├── config.yaml
├── sessions/
├── logs/
├── skills/
└── caches/
```

An Amiba update replaces the immutable application Runtime, while `home/`
remains stable. The Runtime sets `PYTHONDONTWRITEBYTECODE=1`, and all supported
writes are routed to `HERMES_HOME` or temporary directories. System Hermes and
`~/.hermes` remain untouched.

Provider credential saves atomically replace the selected Profile's `.env`,
then Backplane executes Hermes's existing `hermes gateway restart` command.
The save response succeeds only after the old Gateway PID has been replaced
and the new process reports `running`, so later `/v1/runs` requests cannot race
with an acknowledged save and continue using the previous credential. This
flow uses the upstream lifecycle command and requires no credential-reload
patch in Hermes source.

## Amiba-owned downstream patches

Hermes compatibility changes live under `hermes-patches/`. Any local Hermes
checkout selected for development is treated as a read-only input. Each patch
declaration in `hermes-runtime-manifest.json` pins:

- a stable patch id;
- the patch file and its SHA-256;
- a behavioral verifier and its SHA-256.

The build first runs each behavioral verifier against the unpatched staged
copy. When the contract is still missing, it runs `git apply --check`, applies
the patch, and re-runs the verifier with the bundled Python environment.
Downstream patch files contain production changes only; upstream test-suite
changes belong in the upstream PR, while the paired verifier is Amiba's
executable build contract. The combined patch-set hash is part of
`runtime-manifest.json`, so changing a patch or verifier invalidates the
existing Runtime. Development and release artifacts also carry different build
flavors, preventing a local-source artifact from being reused by `package`.

Patch compatibility is classified automatically during every clean Runtime
build:

- **apply** — unpatched Hermes fails the behavioral contract and the diff still
  applies, so the build applies and re-verifies it;
- **retire** — unpatched Hermes already passes the contract, so the build stops
  with instructions to remove the obsolete patch and rebuild the Runtime; the
  changed patch-set hash automatically invalidates the previous bundle;
- **conflict** — the contract still fails but the diff no longer applies, so the
  build stops with both verifier and `git apply --check` diagnostics.

When updating the pinned Hermes commit, every patch must still apply and every
contract verifier must pass. If upstream gains equivalent behavior, remove the
patch declaration and assets, rebuild the Runtime, and keep the Amiba client
event handlers as consumers of the upstream protocol. Do not bump
`bundleSchemaVersion` for patch-content or patch-list changes: the patch-set
hash already covers those. Reserve the schema version for incompatible bundle
layout or runtime-contract changes. An empty `patches` array is valid after the
final downstream patch is retired.

## Local development and Hermes joint debugging

Prepare a runtime once, then start the desktop normally:

```bash
pnpm runtime:prepare
pnpm dev:desktop
```

To test a local Hermes checkout with Amiba's patches without modifying that
checkout:

```bash
pnpm runtime:prepare:local -- --source /absolute/path/to/hermes-agent
pnpm dev:desktop
```

`runtime:prepare:local` fingerprints and copies the explicitly selected checkout
into `resources/hermes-runtime/hermes-agent`, then applies the Amiba-owned
patches to that copy. `dev:desktop` executes the most recently prepared source
directly with its matching Python/dependency runtime. Source or dependency
changes require rerunning the preparation command with the same source path;
the selected checkout itself remains untouched.

An explicit source override remains available for an already prepared fork or
advanced debugging. For persistent per-developer configuration, copy
`.amiba.local.example.ts` to the Git-ignored `.amiba.local.ts` and set:

```ts
import { defineAmibaConfig } from "./apps/desktop/scripts/desktop-local-config.mjs";

export default defineAmibaConfig({
  hermes: {
    mode: "direct-source",
    source: "/absolute/path/to/hermes-agent",
  },
});
```

`defineAmibaConfig` provides TypeScript completion and validation while the real
local configuration remains ignored by Git.

For a one-time override, the environment variable takes precedence:

```bash
AMIBA_HERMES_DEV_SOURCE=/absolute/path/to/hermes-agent \
  pnpm dev:desktop
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
